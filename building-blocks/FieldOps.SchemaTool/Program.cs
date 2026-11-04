using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

var repository = Path.GetFullPath(args.Length > 0 ? args[0] : ".");
foreach (var service in new[] { "work-orders", "technicians", "scheduling", "workflows", "notifications", "reporting" })
{
    var options = new DbContextOptionsBuilder<ServiceDb>().UseNpgsql("Host=localhost;Database=unused").ReplaceService<IModelCacheKeyFactory, ServiceModelKeyFactory>().Options;
    using var db = new ServiceDb(options, new(service));
    var path = Path.Combine(repository, "services", service, "migrations"); Directory.CreateDirectory(path);
    var sql = "-- FieldOps 360 initial schema. Generated from the EF Core ownership model.\n-- Apply with the service migration identity; application roles should have only DML.\n" + db.Database.GenerateCreateScript();
    File.WriteAllText(Path.Combine(path, "001_initial.sql"), sql);
    Console.WriteLine($"Generated {service} initial schema");
}
