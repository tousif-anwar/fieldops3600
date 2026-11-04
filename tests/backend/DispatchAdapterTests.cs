using FieldOps.Core;
using FieldOps.ServiceHost;
using Xunit;

namespace FieldOps.Tests;

public sealed class DispatchAdapterTests
{
    [Fact]
    public void WorkingHoursUseTheActualLocalShiftAcrossDaylightSavingChange()
    {
        var tech = new Technician { TimeZone = "America/New_York", WorkingStartHour = 8, WorkingEndHour = 18 };
        var winter = new DateTimeOffset(2026, 11, 4, 13, 0, 0, TimeSpan.Zero);
        var summer = new DateTimeOffset(2026, 7, 4, 12, 0, 0, TimeSpan.Zero);
        Assert.Equal(new MinuteWindow(780, 1380), SchedulingRecommendations.WorkingWindow(tech, winter, new(winter.UtcDateTime.Date, TimeSpan.Zero)));
        Assert.Equal(new MinuteWindow(720, 1320), SchedulingRecommendations.WorkingWindow(tech, summer, new(summer.UtcDateTime.Date, TimeSpan.Zero)));
    }

    [Fact]
    public void TimeOffAndOverlappingBlockedIntervalsBecomeConservativeDisjointWindows()
    {
        var day = new DateTimeOffset(2026, 11, 4, 0, 0, 0, TimeSpan.Zero);
        Assert.Equal(new MinuteWindow(0, 60), SchedulingRecommendations.Clip(day.AddDays(-1), day.AddHours(1), day));
        Assert.Equal(new[] { new MinuteWindow(480, 600), new MinuteWindow(690, 1080) }, SchedulingRecommendations.Subtract(new(480, 1080), [new(600, 660), new(650, 690)]));
        Assert.Empty(SchedulingRecommendations.Subtract(new(480, 1080), [new(0, 1440)]));
        Assert.Equal(new[] { new MinuteWindow(10, 61) }, SchedulingRecommendations.Merge([new(10, 31), new(30, 61)]));
    }

    [Fact]
    public void OptimizerOutputCannotChangeJobTechnicianOrFixedAppointment()
    {
        var job = new SolverJob("order", ["HVAC"], ["HVAC Safety"], 780, 840, 60, "Normal");
        SchedulingRecommendations.ValidateOutput(job, new("order", "tech-01", 780, 840, []), true);
        Assert.Throws<DomainException>(() => SchedulingRecommendations.ValidateOutput(job, new("other", "tech-01", 780, 840, []), true));
        Assert.Throws<DomainException>(() => SchedulingRecommendations.ValidateOutput(job, new("order", "unknown", 780, 840, []), false));
        Assert.Throws<DomainException>(() => SchedulingRecommendations.ValidateOutput(job, new("order", "tech-01", 781, 841, []), true));
    }

    [Fact]
    public void MigrationDigestNormalizesCrossPlatformLineEndingsOnly()
    {
        Assert.Equal(SchemaMigrator.Normalize("SELECT 1;\r\n\r\n"), SchemaMigrator.Normalize("SELECT 1;\n"));
        Assert.NotEqual(SchemaMigrator.Normalize("SELECT 1;"), SchemaMigrator.Normalize("SELECT 2;"));
    }

    [Fact]
    public void RuntimeRoleConfigurationRejectsMalformedIdentifiersBeforePrivilegedSql()
    {
        SchemaMigrator.ValidateRuntimeRoleName("fieldops_reporting_app");
        Assert.Throws<InvalidOperationException>(() => SchemaMigrator.ValidateRuntimeRoleName("role; DROP TABLE audit_events"));
        Assert.Throws<InvalidOperationException>(() => SchemaMigrator.ValidateRuntimeRoleName(new string('x', 64)));
    }
}
