using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record ServiceIdentity(string Name);

public sealed class ServiceDb(DbContextOptions<ServiceDb> options, ServiceIdentity identity) : DbContext(options)
{
    public string ServiceName => identity.Name;
    public DbSet<WorkOrder> WorkOrders => Set<WorkOrder>();
    public DbSet<Technician> Technicians => Set<Technician>();
    public DbSet<TimeOff> TimeOff => Set<TimeOff>();
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<Workflow> Workflows => Set<Workflow>();
    public DbSet<OutboxMessage> Outbox => Set<OutboxMessage>();
    public DbSet<InboxMessage> Inbox => Set<InboxMessage>();
    public DbSet<IdempotencyReceipt> Receipts => Set<IdempotencyReceipt>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<StoredEvent> Events => Set<StoredEvent>();
    public DbSet<DeliveryAttempt> DeliveryAttempts => Set<DeliveryAttempt>();
    public DbSet<ReplayProjection> ReplayProjections => Set<ReplayProjection>();
    public DbSet<WorkOrderFact> WorkOrderFacts => Set<WorkOrderFact>();
    public DbSet<StageFact> StageFacts => Set<StageFact>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        var owned = identity.Name switch
        {
            "work-orders" => new[] { typeof(WorkOrder) },
            "technicians" => [typeof(Technician), typeof(TimeOff)],
            "scheduling" => [typeof(Booking)],
            "workflows" => [typeof(Workflow)],
            "notifications" => [typeof(Notification)],
            "reporting" => [typeof(StoredEvent), typeof(DeliveryAttempt), typeof(ReplayProjection), typeof(WorkOrderFact), typeof(StageFact)],
            _ => []
        };
        foreach (var type in new[] { typeof(WorkOrder), typeof(Technician), typeof(TimeOff), typeof(Booking), typeof(Workflow), typeof(Notification), typeof(StoredEvent), typeof(DeliveryAttempt), typeof(ReplayProjection), typeof(WorkOrderFact), typeof(StageFact) })
            if (!owned.Contains(type)) b.Ignore(type);
        b.Entity<OutboxMessage>().ToTable("outbox_messages").HasKey(x => x.Id);
        b.Entity<OutboxMessage>().HasIndex(x => new { x.PublishedAtUtc, x.NextAttemptAtUtc });
        b.Entity<OutboxMessage>().Property(x => x.Body).HasColumnType("jsonb");
        b.Entity<InboxMessage>().ToTable("inbox_messages").HasKey(x => x.Id);
        b.Entity<IdempotencyReceipt>().ToTable("idempotency_receipts").HasKey(x => x.Id);
        switch (identity.Name)
        {
            case "work-orders":
                b.Entity<WorkOrder>().ToTable("work_orders");
                b.Entity<WorkOrder>().HasIndex(x => x.Number).IsUnique();
                b.Entity<WorkOrder>().Property(x => x.Version).IsConcurrencyToken();
                break;
            case "technicians":
                b.Entity<Technician>().ToTable("technicians");
                b.Entity<Technician>().Property(x => x.Version).IsConcurrencyToken();
                b.Entity<TimeOff>().ToTable("time_off");
                b.Entity<TimeOff>().HasIndex(x => new { x.TechnicianId, x.StartUtc, x.EndUtc });
                break;
            case "scheduling":
                b.Entity<Booking>().ToTable("bookings");
                b.Entity<Booking>().Property(x => x.Version).IsConcurrencyToken();
                b.Entity<Booking>().HasIndex(x => new { x.WorkOrderId, x.Status });
                break;
            case "workflows":
                b.Entity<Workflow>().ToTable("workflows");
                b.Entity<Workflow>().HasIndex(x => x.WorkOrderId).IsUnique();
                b.Entity<Workflow>().Property(x => x.Version).IsConcurrencyToken();
                b.Entity<Workflow>().Property(x => x.StagesJson).HasColumnType("jsonb");
                break;
            case "notifications":
                b.Entity<Notification>().ToTable("notifications");
                b.Entity<Notification>().HasIndex(x => x.EventId).IsUnique();
                break;
            case "reporting":
                b.Entity<StoredEvent>().ToTable("audit_events").HasKey(x => x.EventId);
                b.Entity<StoredEvent>().HasIndex(x => new { x.WorkOrderId, x.OccurredAtUtc });
                // Preserve the original serialized bytes: jsonb normalization would invalidate the evidence hash.
                b.Entity<StoredEvent>().Property(x => x.Body).HasColumnType("text");
                b.Entity<DeliveryAttempt>().ToTable("delivery_attempts");
                b.Entity<DeliveryAttempt>().HasIndex(x => x.EventId);
                b.Entity<DeliveryAttempt>().HasIndex(x => x.FaultId).HasFilter("\"FaultId\" IS NOT NULL");
                b.Entity<ReplayProjection>().ToTable("replay_projection").HasKey(x => x.WorkOrderId);
                b.Entity<ReplayProjection>().Property(x => x.StateJson).HasColumnType("jsonb");
                b.Entity<WorkOrderFact>().ToTable("fact_work_order").HasKey(x => x.WorkOrderId);
                b.Entity<StageFact>().ToTable("fact_workflow_stage").HasKey(x => x.StageInstanceId);
                break;
        }
    }

    public void Enqueue(AuditEvent message)
    {
        Outbox.Add(new OutboxMessage { Id = message.EventId, Body = Json.Write(message), CreatedAtUtc = message.RecordedAtUtc, NextAttemptAtUtc = message.RecordedAtUtc });
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        if (ChangeTracker.Entries<StoredEvent>().Any(x => x.State is EntityState.Modified or EntityState.Deleted) ||
            ChangeTracker.Entries<DeliveryAttempt>().Any(x => x.State is EntityState.Modified or EntityState.Deleted))
            throw new InvalidOperationException("Audit evidence is append-only.");
        return base.SaveChangesAsync(cancellationToken);
    }
}

public sealed class ServiceModelKeyFactory : Microsoft.EntityFrameworkCore.Infrastructure.IModelCacheKeyFactory
{
    public object Create(DbContext context, bool designTime) => (context.GetType(), ((ServiceDb)context).ServiceName, designTime);
}

public static class DatabaseBootstrap
{
    public static async Task Initialize(WebApplication app)
    {
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ServiceDb>();
        // Schema bootstrap is opt-in. Deployment migration job should hold DDL privileges;
        // the long-running application role does not need them.
        if (!app.Configuration.GetValue("Database:Initialize", false)) return;
        await SchemaMigrator.Apply(db);
        if (db.ServiceName == "technicians" && app.Environment.IsDevelopment() && !await db.Technicians.AnyAsync())
        {
            db.Technicians.AddRange(
                new Technician { Id = "tech-01", Name = "Jordan Lee", Skills = ["HVAC", "Electrical", "Refrigeration"], Certifications = ["HVAC Safety", "EPA 608"] },
                new Technician { Id = "tech-02", Name = "Morgan Reed", Skills = ["HVAC", "Controls"], Certifications = ["HVAC Safety"] },
                new Technician { Id = "tech-03", Name = "Avery Brooks", Skills = ["HVAC", "Mechanical"], Certifications = ["HVAC Safety", "EPA 608"] });
            foreach (var tech in db.ChangeTracker.Entries<Technician>().Where(x => x.State == EntityState.Added).Select(x => x.Entity).ToArray())
                db.Enqueue(EventFactory.Create(null, "technicians", "TechnicianAvailabilityChanged.v1", Guid.Empty, new { technicianId = tech.Id, tech.TeamId, tech.Available, tech.Skills, tech.WorkingStartHour, tech.WorkingEndHour, tech.TimeZone }, tech.Version, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }
    }
}
