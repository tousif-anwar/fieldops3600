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
    public static async Task Apply(ServiceDb db)
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
        await transaction.CommitAsync();
    }

    public static string Normalize(string sql) => sql.Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\r", "\n", StringComparison.Ordinal).TrimEnd() + "\n";
}
