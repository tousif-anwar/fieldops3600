using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public static class ContractPersistence
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<MaintenanceContract>().ToTable("maintenance_contracts");
        b.Entity<MaintenanceContract>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<MaintenanceContract>().HasIndex(x => new { x.TeamId, x.CustomerId, x.Status });
        b.Entity<MaintenanceContract>().HasIndex(x => new { x.Status, x.ExpiresAtUtc });
        b.Entity<MaintenanceContract>().HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MaintenanceContract>().HasMany(x => x.CoveredAssets).WithOne().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MaintenanceContract>().HasMany(x => x.Exclusions).WithOne().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MaintenanceContract>().HasMany(x => x.Plans).WithOne().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MaintenanceContract>().HasMany(x => x.Visits).WithOne().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MaintenanceContract>().HasMany(x => x.Usage).WithOne().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<MaintenanceContract>().HasMany(x => x.Events).WithOne().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);

        b.Entity<ContractLine>().ToTable("contract_lines");
        b.Entity<ContractLine>().HasIndex(x => new { x.ContractId, x.ServiceType }).IsUnique();
        b.Entity<ContractLine>().Property(x => x.PartsAllowance).HasPrecision(18, 2);

        b.Entity<CoveredAsset>().ToTable("contract_covered_assets");
        b.Entity<CoveredAsset>().HasIndex(x => new { x.ContractId, x.AssetId }).IsUnique();

        b.Entity<ContractExclusion>().ToTable("contract_exclusions");
        b.Entity<ContractExclusion>().HasIndex(x => new { x.ContractId, x.ServiceType });

        b.Entity<MaintenancePlan>().ToTable("maintenance_plans");
        b.Entity<MaintenancePlan>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<MaintenancePlan>().HasIndex(x => new { x.ContractLineId, x.AssetId, x.Active });
        b.Entity<MaintenancePlan>().HasIndex(x => new { x.Active, x.NextDueDate });

        b.Entity<MaintenanceVisit>().ToTable("maintenance_visits");
        b.Entity<MaintenanceVisit>().HasIndex(x => new { x.ContractId, x.ContractLineId, x.AssetId, x.DueDate }).IsUnique();
        b.Entity<MaintenanceVisit>().HasIndex(x => new { x.CustomerId, x.DueDate, x.Status });
        b.Entity<MaintenanceVisit>().HasIndex(x => x.WorkOrderId).HasFilter("\"WorkOrderId\" IS NOT NULL");

        b.Entity<ContractUsage>().ToTable("contract_usage");
        b.Entity<ContractUsage>().Property(x => x.PartsCost).HasPrecision(18, 2);
        b.Entity<ContractUsage>().HasIndex(x => new { x.ContractLineId, x.WorkOrderId }).IsUnique();
        b.Entity<ContractUsage>().HasIndex(x => new { x.ContractId, x.OccurredAtUtc });

        b.Entity<ContractEvent>().ToTable("contract_events");
        b.Entity<ContractEvent>().Property(x => x.DetailsJson).HasColumnType("jsonb");
        b.Entity<ContractEvent>().HasIndex(x => new { x.ContractId, x.Version });
    }

    public static void Ignore(ModelBuilder b)
    {
        foreach (var type in new[]
                 {
                     typeof(MaintenanceContract), typeof(ContractLine), typeof(CoveredAsset), typeof(ContractExclusion),
                     typeof(MaintenancePlan), typeof(MaintenanceVisit), typeof(ContractUsage), typeof(ContractEvent)
                 })
            b.Ignore(type);
    }
}
