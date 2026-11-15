namespace FieldOps.Core;

/// <summary>Explicit application currency policy; it does not supply tax rates or jurisdiction rules.</summary>
public sealed record CurrencyPolicy
{
    public string Code { get; }
    public int DecimalPlaces { get; }

    public CurrencyPolicy(string code, int decimalPlaces)
    {
        if (code is null || code.Length != 3 || code.Any(c => c is < 'A' or > 'Z'))
            throw new DomainException(400, "Currency must be a configured three-letter uppercase code.");
        if (decimalPlaces is < 0 or > 4)
            throw new DomainException(400, "Currency precision must be between zero and four decimal places.");
        Code = code;
        DecimalPlaces = decimalPlaces;
    }

    public decimal Round(decimal amount) => decimal.Round(amount, DecimalPlaces, MidpointRounding.AwayFromZero);
}

public sealed record MonetaryLine(decimal Subtotal, decimal Discount, decimal Net, decimal Tax, decimal Total);

public static class MonetaryPolicy
{
    // Round each posted line component once. Invoice totals sum those posted components,
    // so a displayed total never differs from the sum of its displayed lines.
    public static MonetaryLine CalculateLine(CurrencyPolicy currency, decimal quantity, decimal unitPrice,
        decimal discountPercent = 0, decimal taxPercent = 0)
    {
        if (quantity <= 0 || quantity > 1_000_000 || decimal.Round(quantity, 3) != quantity)
            throw new DomainException(400, "Quantity must be positive, at most one million, with up to three decimal places.");
        if (unitPrice < 0 || unitPrice > 1_000_000_000 || decimal.Round(unitPrice, 4) != unitPrice)
            throw new DomainException(400, "Unit price must be nonnegative, at most one billion, with up to four decimal places.");
        if (discountPercent is < 0 or > 100 || taxPercent is < 0 or > 100)
            throw new DomainException(400, "Discount and configured tax percentages must be between zero and one hundred.");
        var subtotal = currency.Round(quantity * unitPrice);
        var discount = currency.Round(subtotal * discountPercent / 100m);
        var net = subtotal - discount;
        var tax = currency.Round(net * taxPercent / 100m);
        return new(subtotal, discount, net, tax, net + tax);
    }

    public static decimal LaborCost(CurrencyPolicy currency, decimal minutes, decimal hourlyRate)
    {
        if (minutes < 0 || minutes > 525_600 || hourlyRate < 0 || hourlyRate > 1_000_000)
            throw new DomainException(400, "Labor minutes or hourly rate are outside the supported bounds.");
        return currency.Round(minutes * hourlyRate / 60m);
    }
}
