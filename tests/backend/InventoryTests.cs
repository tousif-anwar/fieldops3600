using System.Globalization;
using FieldOps.Core;
using Xunit;

namespace FieldOps.Tests;

public sealed class InventoryTests
{
    [Fact]
    public void ReservationsProtectStockAndReleaseOnlyOutstandingQuantity()
    {
        var balance = new StockBalance { OnHand = 10 };
        var reservation = new InventoryReservation { Quantity = 7 };
        InventoryRules.Reserve(balance, 7);
        Assert.Equal(3, balance.Available);
        Assert.Equal(409, Assert.Throws<DomainException>(() => InventoryRules.Reserve(balance, 4)).Status);
        InventoryRules.Release(balance, reservation, 2);
        Assert.Equal(5, balance.Available);
        Assert.Equal(5, reservation.Remaining);
        Assert.Throws<DomainException>(() => InventoryRules.Release(balance, reservation, 6));
        Assert.Equal(5, balance.Reserved);
    }

    [Fact]
    public void ConsumptionPreservesReservationsAndReturnsDoNotRestoreOldReservations()
    {
        var balance = new StockBalance { OnHand = 10, Reserved = 7 };
        var reservation = new InventoryReservation { Quantity = 7 };
        Assert.Throws<DomainException>(() => InventoryRules.Consume(balance, 4, null));
        InventoryRules.Consume(balance, 4, reservation);
        Assert.Equal(6, balance.OnHand); Assert.Equal(3, balance.Reserved); Assert.Equal(3, balance.Available);
        var consumption = new InventoryConsumption { Quantity = 4 };
        InventoryRules.Return(balance, consumption, 2);
        Assert.Equal(8, balance.OnHand); Assert.Equal(3, balance.Reserved); Assert.Equal(5, balance.Available);
        Assert.Throws<DomainException>(() => InventoryRules.Return(balance, consumption, 3));
        Assert.Throws<DomainException>(() => InventoryRules.Adjust(balance, -6));
        Assert.Equal(8, balance.OnHand);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("1000001")]
    [InlineData("0.0001")]
    public void InvalidQuantityIsRejectedInsteadOfRounded(string input) => Assert.Throws<DomainException>(() => InventoryRules.Quantity(decimal.Parse(input, CultureInfo.InvariantCulture)));

    [Fact]
    public void UnitCostsRetainFourPlacesAndRejectExcessPrecision()
    {
        InventoryRules.Cost(0.1234m);
        Assert.Throws<DomainException>(() => InventoryRules.Cost(0.12345m));
        Assert.Throws<DomainException>(() => InventoryRules.Cost(-1));
        Assert.Throws<DomainException>(() => InventoryRules.TransferOut(new StockBalance { OnHand = 10, Reserved = 8 }, 3));
    }
}
