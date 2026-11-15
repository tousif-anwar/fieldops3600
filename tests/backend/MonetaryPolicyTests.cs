using FieldOps.Core;
using Xunit;

namespace FieldOps.Tests;

public sealed class MonetaryPolicyTests
{
    [Fact]
    public void FractionalPartQuantityDiscountAndConfiguredTaxReconcile()
    {
        var result = MonetaryPolicy.CalculateLine(new("USD", 2), 1.125m, 19.995m, 10m, 7.25m);
        Assert.Equal(22.49m, result.Subtotal);
        Assert.Equal(2.25m, result.Discount);
        Assert.Equal(20.24m, result.Net);
        Assert.Equal(1.47m, result.Tax);
        Assert.Equal(result.Subtotal - result.Discount + result.Tax, result.Total);
        Assert.Equal(21.71m, result.Total);
    }

    [Theory]
    [InlineData("1.005", "1.01")]
    [InlineData("-1.005", "-1.01")]
    public void MidpointsUseTheSameRuleForChargesAndCredits(string input, string expected)
    {
        var culture = System.Globalization.CultureInfo.InvariantCulture;
        Assert.Equal(decimal.Parse(expected, culture), new CurrencyPolicy("USD", 2).Round(decimal.Parse(input, culture)));
    }

    [Fact]
    public void CurrencyPrecisionIsConfiguredRatherThanAssumed()
    {
        Assert.Equal(11m, new CurrencyPolicy("JPY", 0).Round(10.5m));
        Assert.Equal(10.501m, new CurrencyPolicy("KWD", 3).Round(10.5005m));
        Assert.Equal(0m, MonetaryPolicy.CalculateLine(new("USD", 2), 1m, 20m, 100m, 5m).Total);
    }

    [Fact]
    public void MinuteCostIsNotAnHourlyChargeOrPayrollCalculation()
    {
        Assert.Equal(18.52m, MonetaryPolicy.LaborCost(new("USD", 2), 17m, 65.35m));
    }

    [Theory]
    [InlineData(0, 1, 0, 0)]
    [InlineData(-1, 1, 0, 0)]
    [InlineData(1, -1, 0, 0)]
    [InlineData(1, 1, 101, 0)]
    [InlineData(1, 1, 0, -1)]
    public void InvalidMoneyInputsAreRejected(decimal quantity, decimal price, decimal discount, decimal tax)
    {
        Assert.Throws<DomainException>(() => MonetaryPolicy.CalculateLine(new("USD", 2), quantity, price, discount, tax));
    }

    [Fact]
    public void ExcessPrecisionAndInvalidCurrencyAreRejected()
    {
        Assert.Throws<DomainException>(() => MonetaryPolicy.CalculateLine(new("USD", 2), 0.0001m, 1m));
        Assert.Throws<DomainException>(() => MonetaryPolicy.CalculateLine(new("USD", 2), 1m, 0.00001m));
        Assert.Throws<DomainException>(() => new CurrencyPolicy("usd", 2));
        Assert.Throws<DomainException>(() => new CurrencyPolicy("USD", 5));
    }
}
