using System.Text.Json;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Xunit;

namespace FieldOps.Tests;

public sealed class SchedulingSecurityReplayTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 4, 13, 0, 0, TimeSpan.Zero);
    private static Technician Qualified() => new() { Id = "tech-01", TeamId = "north", Skills = ["HVAC"], Certifications = ["HVAC Safety"] };
    private static WorkOrder Order() => new() { TeamId = "north", ServiceCategory = "HVAC" };

    [Fact]
    public void BookingHonorsQualificationsHoursTeamAndTimeOff()
    {
        var tech = Qualified(); var order = Order();
        BookingRules.Validate(tech, order, Start, Start.AddHours(1), []);
        Assert.Throws<DomainException>(() => BookingRules.Validate(tech, order, Start.AddHours(-1), Start, []));
        Assert.Throws<DomainException>(() => BookingRules.Validate(tech, order, Start, Start.AddHours(1), [new TimeOff { StartUtc = Start, EndUtc = Start.AddMinutes(10) }]));
        tech.Skills = []; Assert.Throws<DomainException>(() => BookingRules.Validate(tech, order, Start, Start.AddHours(1), []));
        tech = Qualified(); tech.Certifications = []; Assert.Throws<DomainException>(() => BookingRules.Validate(tech, order, Start, Start.AddHours(1), []));
        tech = Qualified(); tech.TeamId = "south"; Assert.Throws<DomainException>(() => BookingRules.Validate(tech, order, Start, Start.AddHours(1), []));
        Assert.False(BookingRules.Overlaps(Start, Start.AddHours(1), Start.AddHours(1), Start.AddHours(2)));
        Assert.True(BookingRules.Overlaps(Start, Start.AddHours(1), Start.AddMinutes(59), Start.AddHours(2)));
    }

    [Fact]
    public void ResourceAuthorizationRejectsForeignTeamsAndOtherTechnicians()
    {
        var tech = new Caller("tech-01", "north", "Technician", false, true);
        Assert.True(tech.CanAccess("north", "tech-01"));
        Assert.False(tech.CanAccess("north", "tech-02"));
        Assert.False(tech.CanAccess("south", "tech-01"));
        Assert.False(new Caller("supervisor-01", "", "Supervisor", false, false).CanAccess("north"));
        Assert.True(new Caller("admin-01", "", "Administrator", true, false).CanAccess("south"));
    }

    private static AuditEvent Event(string type, int minutes, int sequence, string source = "workflows", Guid? cause = null) => new(Guid.NewGuid(), type, 1, Guid.Empty, null, null, "tech-01", "Technician", source, "correlation", cause, "trace", "span", Start.AddMinutes(minutes), Start.AddMinutes(minutes), sequence, JsonSerializer.SerializeToElement(new { teamId = "north", stageName = "Diagnosis", technicianId = "tech-01" }, Json.Options));

    [Fact]
    public void ReplayDeduplicatesAndOrdersLateSourceEvents()
    {
        var first = Event("StageStarted.v1", 1, 1);
        var warning = Event("StageWarningRaised.v1", 21, 2);
        var breach = Event("StageSLABreached.v1", 31, 3);
        var ordered = ReplayEngine.Order([breach, first, warning, first]);
        Assert.Equal(new[] { first.EventId, warning.EventId, breach.EventId }, ordered.Select(x => x.Event.EventId));
        Assert.Equal("Breached", ReplayEngine.Reconstruct([breach, first, warning]).SlaStatus);
    }

    [Fact]
    public void ReplayUsesCausationDespiteClockSkewAndMarksMissingEvidence()
    {
        var cause = Event("BookingCreated.v1", 5, 1, "scheduling");
        var effect = Event("WorkflowStarted.v1", 1, 1, "workflows", cause.EventId);
        Assert.Equal(cause.EventId, ReplayEngine.Order([effect, cause])[0].Event.EventId);
        Assert.True(Assert.Single(ReplayEngine.Order([effect])).MissingCausation);
    }

    [Fact]
    public void IndependentServicesReportOrderingUncertainty()
    {
        var ordered = ReplayEngine.Order([Event("WorkOrderCreated.v1", 0, 1, "work-orders"), Event("BookingCreated.v1", 0, 1, "scheduling")]);
        Assert.True(ordered[0].OrderingUncertain);
    }

    [Fact]
    public void EachDatabaseModelContainsOnlyItsOwnedBusinessData()
    {
        foreach (var service in new[] { "work-orders", "technicians", "scheduling", "workflows", "notifications", "reporting" })
        {
            var options = new DbContextOptionsBuilder<ServiceDb>().UseNpgsql("Host=localhost;Database=unused").ReplaceService<IModelCacheKeyFactory, ServiceModelKeyFactory>().Options;
            using var db = new ServiceDb(options, new(service));
            Assert.Equal(service == "work-orders", db.Model.FindEntityType(typeof(WorkOrder)) is not null);
            Assert.Equal(service == "workflows", db.Model.FindEntityType(typeof(Workflow)) is not null);
            Assert.Equal(service == "reporting", db.Model.FindEntityType(typeof(StoredEvent)) is not null);
        }
    }

    [Fact]
    public async Task EvidenceMutationIsRejectedBeforeSendingSql()
    {
        var options = new DbContextOptionsBuilder<ServiceDb>().UseNpgsql("Host=localhost;Database=unused").Options;
        using var db = new ServiceDb(options, new("reporting"));
        var evidence = new StoredEvent { EventId = Guid.NewGuid() };
        db.Attach(evidence); evidence.Body = "tampered"; db.ChangeTracker.DetectChanges();
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public void PdfHasValidHeaderCrossReferenceAndMultiplePages()
    {
        var pdf = System.Text.Encoding.ASCII.GetString(Pdf.Create(Enumerable.Range(0, 100).Select(i => $"Fact ({i})")));
        Assert.StartsWith("%PDF-1.4", pdf);
        Assert.Contains("/Count 3", pdf);
        Assert.Contains("startxref", pdf);
        Assert.EndsWith("%%EOF", pdf);
    }
}
