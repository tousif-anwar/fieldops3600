using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed partial class ServiceDb
{
    public DbSet<ContractRenewalRecord> ContractRenewals => Set<ContractRenewalRecord>();
}

public static class ContractLifecyclePersistence
{
    public static void Configure(ModelBuilder b)
    {
        var renewal = b.Entity<ContractRenewalRecord>().ToTable("contract_renewals");
        renewal.HasKey(x => x.Id);
        renewal.HasIndex(x => x.SourceContractId).IsUnique();
        renewal.HasIndex(x => x.RenewedContractId).IsUnique();
        renewal.HasIndex(x => new { x.ActorId, x.OperationId }).IsUnique();
        renewal.HasOne<MaintenanceContract>().WithMany().HasForeignKey(x => x.SourceContractId).OnDelete(DeleteBehavior.Restrict);
        renewal.HasOne<MaintenanceContract>().WithMany().HasForeignKey(x => x.RenewedContractId).OnDelete(DeleteBehavior.Restrict);
    }

    public static void Ignore(ModelBuilder b) => b.Ignore<ContractRenewalRecord>();
}
