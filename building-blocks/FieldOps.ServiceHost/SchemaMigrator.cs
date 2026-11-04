using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace FieldOps.ServiceHost;

public static class SchemaMigrator
{
    // Numbered SQL is immutable once applied. A digest detects edited migration history.
    // Runtime identity may omit DDL when Database:Initialize=false after this deployment job.
    public static async Task Apply(ServiceDb db, string? runtimeRole = null)
    {
        await db.Database.OpenConnectionAsync();
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtext(@service)); CREATE TABLE IF NOT EXISTS fieldops_schema_migrations (migration_id text PRIMARY KEY, sha256 text NOT NULL, applied_at_utc timestamptz NOT NULL DEFAULT now());", connection, transaction))
        {
            command.Parameters.AddWithValue("service", "fieldops-schema-" + db.ServiceName); await command.ExecuteNonQueryAsync();
        }
        var assembly = typeof(SchemaMigrator).Assembly;
        var resources = assembly.GetManifestResourceNames().Where(x => x.StartsWith(db.ServiceName + ".", StringComparison.Ordinal) && x.EndsWith(".sql", StringComparison.Ordinal)).Order(StringComparer.Ordinal).ToArray();
        if (resources.Length == 0) throw new InvalidOperationException($"No migrations were embedded for {db.ServiceName}.");
        foreach (var resource in resources)
        {
            using var reader = new StreamReader(assembly.GetManifestResourceStream(resource)!); var sql = Normalize(await reader.ReadToEndAsync());
            var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql)));
            await using var read = new NpgsqlCommand("SELECT sha256 FROM fieldops_schema_migrations WHERE migration_id=@id", connection, transaction); read.Parameters.AddWithValue("id", resource);
            var applied = (string?)await read.ExecuteScalarAsync();
            if (applied is not null)
            {
                if (applied != digest) throw new InvalidOperationException($"Applied migration {resource} changed. Restore it and append a new numbered migration.");
                continue;
            }
            await using var migrate = new NpgsqlCommand(sql, connection, transaction); await migrate.ExecuteNonQueryAsync();
            await using var record = new NpgsqlCommand("INSERT INTO fieldops_schema_migrations(migration_id,sha256) VALUES(@id,@hash)", connection, transaction); record.Parameters.AddWithValue("id", resource); record.Parameters.AddWithValue("hash", digest); await record.ExecuteNonQueryAsync();
        }
        if (!string.IsNullOrWhiteSpace(runtimeRole)) await GrantRuntimeRole(connection, transaction, db.ServiceName, runtimeRole);
        await transaction.CommitAsync();
    }

    public static string Normalize(string sql) => sql.Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\r", "\n", StringComparison.Ordinal).TrimEnd() + "\n";

    public static void ValidateRuntimeRoleName(string role)
    {
        if (role.Length is < 1 or > 63 || role[0] is < 'a' or > 'z' || role.Any(c => !(c is >= 'a' and <= 'z' or >= '0' and <= '9' or '_')))
            throw new InvalidOperationException("Database:RuntimeRole must be a lowercase PostgreSQL identifier of at most 63 characters.");
    }

    private static async Task GrantRuntimeRole(NpgsqlConnection connection, NpgsqlTransaction transaction, string service, string runtimeRole)
    {
        ValidateRuntimeRoleName(runtimeRole);
        await using (var validate = new NpgsqlCommand("""
            SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls
              OR r.rolname=current_user OR pg_has_role(r.oid,current_user,'MEMBER')
              OR EXISTS(SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND d.datdba=r.oid)
              OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=r.oid)
            FROM pg_roles r WHERE r.rolname=@role
            """, connection, transaction))
        {
            validate.Parameters.AddWithValue("role", runtimeRole);
            var unsafeRole = await validate.ExecuteScalarAsync();
            if (unsafeRole is not bool elevated) throw new InvalidOperationException($"Runtime role {runtimeRole} must be provisioned before migration.");
            if (elevated) throw new InvalidOperationException("Runtime identity must not own schema objects or inherit migration-owner/administrative privileges.");
        }
        using var identifiers = new NpgsqlCommandBuilder();
        var role = identifiers.QuoteIdentifier(runtimeRole); var database = identifiers.QuoteIdentifier(connection.Database);
        var grants = $"""
            REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE {database} FROM PUBLIC;
            GRANT CONNECT ON DATABASE {database} TO {role};
            REVOKE CREATE,TEMPORARY ON DATABASE {database} FROM {role};
            REVOKE CREATE ON SCHEMA public FROM PUBLIC;
            REVOKE ALL ON SCHEMA public FROM {role};
            GRANT USAGE ON SCHEMA public TO {role};
            REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role};
            GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {role};
            GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO {role};
            REVOKE ALL ON fieldops_schema_migrations FROM PUBLIC,{role};
            GRANT SELECT ON fieldops_schema_migrations TO {role};
            ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM {role};
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO {role};
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO {role};
            """;
        if (service == "reporting") grants += $"""

            REVOKE ALL ON audit_events,delivery_attempts FROM PUBLIC,{role};
            GRANT SELECT,INSERT ON audit_events,delivery_attempts TO {role};
            """;
        await using var apply = new NpgsqlCommand(grants, connection, transaction); await apply.ExecuteNonQueryAsync();
    }
}
