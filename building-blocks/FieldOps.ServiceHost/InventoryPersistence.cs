using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed partial class ServiceDb
{
    public DbSet<InventoryPart> InventoryParts => Set<InventoryPart>();
    public DbSet<StockLocation> StockLocations => Set<StockLocation>();
    public DbSet<StockBalance> StockBalances => Set<StockBalance>();
    public DbSet<InventoryReservation> InventoryReservations => Set<InventoryReservation>();
    public DbSet<StockTransfer> StockTransfers => Set<StockTransfer>();
    public DbSet<InventoryConsumption> InventoryConsumptions => Set<InventoryConsumption>();
    public DbSet<InventoryMovement> InventoryMovements => Set<InventoryMovement>();
    public DbSet<InventoryPartRequest> InventoryPartRequests => Set<InventoryPartRequest>();
}

public static class InventoryPersistence
{
    private static readonly Type[] Entities = [typeof(InventoryPart), typeof(StockLocation), typeof(StockBalance), typeof(InventoryReservation), typeof(StockTransfer), typeof(InventoryConsumption), typeof(InventoryMovement), typeof(InventoryPartRequest)];
    public static void Ignore(ModelBuilder builder) { foreach (var type in Entities) builder.Ignore(type); }
    public static void Configure(ModelBuilder b)
    {
        b.Entity<InventoryPart>().ToTable("inventory_parts");
        b.Entity<InventoryPart>().HasIndex(x => new { x.TeamId, x.Sku }).IsUnique();
        b.Entity<InventoryPart>().Property(x => x.UnitCost).HasPrecision(18, 4);
        b.Entity<InventoryPart>().Property(x => x.ReorderPoint).HasPrecision(18, 3);
        b.Entity<InventoryPart>().Property(x => x.ReorderQuantity).HasPrecision(18, 3);
        b.Entity<StockLocation>().ToTable("stock_locations");
        b.Entity<StockLocation>().HasIndex(x => new { x.TeamId, x.TechnicianId }).IsUnique().HasFilter("\"Kind\"='Vehicle' AND \"Active\"");
        b.Entity<StockBalance>().ToTable("stock_balances").HasKey(x => new { x.PartId, x.LocationId });
        b.Entity<StockBalance>().Ignore(x => x.Available);
        b.Entity<StockBalance>().Property(x => x.OnHand).HasPrecision(18, 3);
        b.Entity<StockBalance>().Property(x => x.Reserved).HasPrecision(18, 3);
        b.Entity<StockBalance>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<StockBalance>().HasOne<InventoryPart>().WithMany().HasForeignKey(x => x.PartId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StockBalance>().HasOne<StockLocation>().WithMany().HasForeignKey(x => x.LocationId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<InventoryReservation>().ToTable("inventory_reservations");
        b.Entity<InventoryReservation>().Ignore(x => x.Remaining);
        b.Entity<InventoryReservation>().HasIndex(x => new { x.WorkOrderId, x.PartId, x.LocationId }).IsUnique().HasFilter("\"Status\"='Active'");
        b.Entity<StockTransfer>().ToTable("stock_transfers");
        b.Entity<InventoryConsumption>().ToTable("inventory_consumptions");
        b.Entity<InventoryConsumption>().Property(x => x.UnitCost).HasPrecision(18, 4);
        b.Entity<InventoryMovement>().ToTable("inventory_movements");
        b.Entity<InventoryMovement>().HasIndex(x => new { x.TeamId, x.OccurredAtUtc });
        b.Entity<InventoryPartRequest>().ToTable("inventory_part_requests");
        foreach (var type in new[] { typeof(InventoryReservation), typeof(StockTransfer), typeof(InventoryConsumption), typeof(InventoryMovement), typeof(InventoryPartRequest) })
            foreach (var property in type.GetProperties().Where(x => x.PropertyType == typeof(decimal) && x.CanWrite))
                if (property.Name != nameof(InventoryConsumption.UnitCost)) b.Entity(type).Property(property.Name).HasPrecision(18, 3);
    }
}
