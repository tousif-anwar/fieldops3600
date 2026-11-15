namespace FieldOps.Core;

public sealed class InventoryPart
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TeamId { get; set; } = "";
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public string Unit { get; set; } = "Each";
    public string Currency { get; set; } = "USD";
    public decimal UnitCost { get; set; }
    public decimal ReorderPoint { get; set; }
    public decimal ReorderQuantity { get; set; }
    public bool Active { get; set; } = true;
    public int Version { get; set; } = 1;
}

// Warehouses and technician vehicles are stock locations with different access rules.
public sealed class StockLocation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TeamId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "CentralWarehouse";
    public string? TechnicianId { get; set; }
    public bool Active { get; set; } = true;
    public int Version { get; set; } = 1;
}

public sealed class StockBalance
{
    public Guid PartId { get; set; }
    public Guid LocationId { get; set; }
    public decimal OnHand { get; set; }
    public decimal Reserved { get; set; }
    public int Version { get; set; } = 1;
    public decimal Available => OnHand - Reserved;
}

public sealed class InventoryReservation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TeamId { get; set; } = "";
    public Guid WorkOrderId { get; set; }
    public Guid PartId { get; set; }
    public Guid LocationId { get; set; }
    public decimal Quantity { get; set; }
    public decimal ConsumedQuantity { get; set; }
    public decimal ReleasedQuantity { get; set; }
    public string Status { get; set; } = "Active";
    public string ActorId { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
    public decimal Remaining => Quantity - ConsumedQuantity - ReleasedQuantity;
}

public sealed class StockTransfer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TeamId { get; set; } = "";
    public Guid PartId { get; set; }
    public Guid SourceLocationId { get; set; }
    public Guid DestinationLocationId { get; set; }
    public Guid? WorkOrderId { get; set; }
    public decimal Quantity { get; set; }
    public decimal ReceivedQuantity { get; set; }
    public string Status { get; set; } = "InTransit";
    public string ActorId { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? ReceivedAtUtc { get; set; }
}

public sealed class InventoryConsumption
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TeamId { get; set; } = "";
    public Guid WorkOrderId { get; set; }
    public Guid PartId { get; set; }
    public Guid LocationId { get; set; }
    public Guid? ReservationId { get; set; }
    public decimal Quantity { get; set; }
    public decimal ReturnedQuantity { get; set; }
    public decimal UnitCost { get; set; }
    public string Currency { get; set; } = "USD";
    public string ActorId { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
}

public sealed class InventoryMovement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TeamId { get; set; } = "";
    public Guid PartId { get; set; }
    public Guid? SourceLocationId { get; set; }
    public Guid? DestinationLocationId { get; set; }
    public Guid? WorkOrderId { get; set; }
    public Guid ReferenceId { get; set; }
    public string Kind { get; set; } = "";
    public decimal Quantity { get; set; }
    public string Reason { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string ActorRole { get; set; } = "";
    public string CorrelationId { get; set; } = "";
    public DateTimeOffset OccurredAtUtc { get; set; }
}

public sealed class InventoryPartRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TeamId { get; set; } = "";
    public Guid WorkOrderId { get; set; }
    public Guid PartId { get; set; }
    public decimal Quantity { get; set; }
    public string Kind { get; set; } = "Additional";
    public string Reason { get; set; } = "";
    public string Status { get; set; } = "Open";
    public string ActorId { get; set; } = "";
    public string? ClosedBy { get; set; }
    public string? Resolution { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? ClosedAtUtc { get; set; }
}

public static class InventoryRules
{
    public static readonly string[] LocationKinds = ["CentralWarehouse", "RegionalWarehouse", "Vehicle", "Other"];
    public static void Quantity(decimal quantity)
    {
        if (quantity <= 0 || quantity > 1_000_000 || decimal.Round(quantity, 3) != quantity)
            throw new DomainException(400, "Quantity must be positive, at most 1000000, and have at most three decimal places.");
    }
    public static void Cost(decimal value)
    {
        if (value < 0 || value > 1_000_000_000 || decimal.Round(value, 4) != value)
            throw new DomainException(400, "Unit cost must be nonnegative and have at most four decimal places.");
    }
    public static void Text(string? text, int minimum, int maximum, string field)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Trim().Length < minimum || text.Length > maximum)
            throw new DomainException(400, $"{field} must contain {minimum}–{maximum} characters.");
    }
    public static void Receive(StockBalance balance, decimal quantity)
    {
        Quantity(quantity); balance.OnHand += quantity; balance.Version++;
    }
    public static void Reserve(StockBalance balance, decimal quantity)
    {
        Quantity(quantity);
        if (balance.Available < quantity) throw new DomainException(409, "Not enough available stock. Refresh the balance before retrying.");
        balance.Reserved += quantity; balance.Version++;
    }
    public static void Release(StockBalance balance, InventoryReservation reservation, decimal quantity)
    {
        Quantity(quantity);
        if (reservation.Remaining < quantity || balance.Reserved < quantity) throw new DomainException(409, "The reservation no longer has that quantity available.");
        reservation.ReleasedQuantity += quantity; balance.Reserved -= quantity; balance.Version++;
        if (reservation.Remaining == 0) reservation.Status = "Closed";
    }
    public static void Consume(StockBalance balance, decimal quantity, InventoryReservation? reservation)
    {
        Quantity(quantity);
        if (reservation is null)
        {
            if (balance.Available < quantity) throw new DomainException(409, "Not enough unreserved stock at this location.");
        }
        else
        {
            if (reservation.Remaining < quantity || balance.Reserved < quantity) throw new DomainException(409, "The reservation no longer has that quantity available.");
            reservation.ConsumedQuantity += quantity; balance.Reserved -= quantity;
            if (reservation.Remaining == 0) reservation.Status = "Closed";
        }
        if (balance.OnHand < quantity) throw new DomainException(409, "Not enough stock at this location.");
        balance.OnHand -= quantity; balance.Version++;
    }
    public static void TransferOut(StockBalance balance, decimal quantity)
    {
        Quantity(quantity);
        if (balance.Available < quantity) throw new DomainException(409, "Transfer exceeds unreserved stock. Release any job reservation first.");
        balance.OnHand -= quantity; balance.Version++;
    }
    public static void Return(StockBalance balance, InventoryConsumption consumption, decimal quantity)
    {
        Quantity(quantity);
        if (consumption.Quantity - consumption.ReturnedQuantity < quantity) throw new DomainException(409, "Return exceeds the remaining consumed quantity.");
        consumption.ReturnedQuantity += quantity; balance.OnHand += quantity; balance.Version++;
    }
    public static void Adjust(StockBalance balance, decimal delta)
    {
        if (delta == 0) throw new DomainException(400, "Adjustment must change the stock balance.");
        Quantity(Math.Abs(delta));
        if (balance.OnHand + delta < balance.Reserved) throw new DomainException(409, "Adjustment would reduce stock below its reserved quantity.");
        balance.OnHand += delta; balance.Version++;
    }
}
