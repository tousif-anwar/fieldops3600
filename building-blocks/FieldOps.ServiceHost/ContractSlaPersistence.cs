using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed partial class ServiceDb
{
    public DbSet<WorkOrderSlaSnapshot> WorkOrderSlaSnapshots => Set<WorkOrderSlaSnapshot>();
    public DbSet<WorkOrderSlaState> WorkOrderSlaStates => Set<WorkOrderSlaState>();
    public DbSet<WorkOrderSlaEvidence> WorkOrderSlaEvidence => Set<WorkOrderSlaEvidence>();
}

public static class ContractSlaPersistence
{
    public static void Configure(ModelBuilder builder)
    {
        builder.Entity<WorkOrderSlaSnapshot>().ToTable("work_order_sla_snapshots").HasKey(x => x.WorkOrderId);
        builder.Entity<WorkOrderSlaSnapshot>().HasOne<WorkOrder>().WithOne()
            .HasForeignKey<WorkOrderSlaSnapshot>(x => x.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<WorkOrderSlaState>().ToTable("work_order_sla_states").HasKey(x => x.WorkOrderId);
        builder.Entity<WorkOrderSlaState>().Property(x => x.Version).IsConcurrencyToken();
        builder.Entity<WorkOrderSlaState>().HasOne<WorkOrderSlaSnapshot>().WithOne()
            .HasForeignKey<WorkOrderSlaState>(x => x.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<WorkOrderSlaState>().HasIndex(x => x.ResponseDueAtUtc);
        builder.Entity<WorkOrderSlaState>().HasIndex(x => x.CompletionDueAtUtc);
        builder.Entity<WorkOrderSlaEvidence>().ToTable("work_order_sla_evidence").HasKey(x => x.Id);
        builder.Entity<WorkOrderSlaEvidence>().Property(x => x.DetailsJson).HasColumnType("jsonb");
        builder.Entity<WorkOrderSlaEvidence>().HasIndex(x => new { x.WorkOrderId, x.SemanticKey }).IsUnique();
        builder.Entity<WorkOrderSlaEvidence>().HasIndex(x => new { x.WorkOrderId, x.RecordedAtUtc });
        builder.Entity<WorkOrderSlaEvidence>().HasOne<WorkOrderSlaSnapshot>().WithMany()
            .HasForeignKey(x => x.WorkOrderId).OnDelete(DeleteBehavior.Restrict);
        builder.Entity<WorkOrderSlaEvidence>().HasOne<WorkOrderSlaEvidence>().WithMany()
            .HasForeignKey(x => x.RelatedEvidenceId).OnDelete(DeleteBehavior.Restrict);
    }

    public static void Ignore(ModelBuilder builder)
    {
        builder.Ignore<WorkOrderSlaSnapshot>();
        builder.Ignore<WorkOrderSlaState>();
        builder.Ignore<WorkOrderSlaEvidence>();
    }
}
