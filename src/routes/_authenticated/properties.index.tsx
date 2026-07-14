import { useDeferredValue, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, MapPin, Plus, Search, SlidersHorizontal, UserRound } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app-shell";
import { PropertyEditor } from "@/components/properties/property-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/lib/workspace-context";
import { listProperties } from "@/lib/properties.functions";
import { propertyAddress, propertyPrice, propertyTitle } from "@/lib/property-presentation";
import { PROPERTY_PROJECT_TYPES, propertyProjectTypeLabel } from "@/lib/property-project-types";

export const Route = createFileRoute("/_authenticated/properties/")({
  head: () => ({ meta: [{ title: "Properties | Agir" }] }),
  component: PropertiesPage,
});

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

function matchLabel(scope?: string) {
  if (scope === "historical") return "Historical match";
  if (scope === "current_and_historical") return "Current + history";
  return null;
}

function PropertiesPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.personal ? null : (activeWorkspace?.id ?? null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [projectType, setProjectType] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const search = useDeferredValue(query.trim());
  const qc = useQueryClient();

  const propertiesQ = useInfiniteQuery({
    queryKey: [
      "properties",
      workspaceId,
      search,
      municipality,
      projectType,
      minPrice,
      maxPrice,
      includeArchived,
    ],
    initialPageParam: null as { updated_at: string; id: string } | null,
    queryFn: ({ pageParam }) =>
      listProperties({
        data: {
          workspace_id: workspaceId,
          query: search || undefined,
          municipality: municipality.trim() || undefined,
          project_type: projectType.trim() || undefined,
          min_price: optionalNumber(minPrice),
          max_price: optionalNumber(maxPrice),
          include_archived: includeArchived,
          before_updated_at: pageParam?.updated_at ?? null,
          before_id: pageParam?.id ?? null,
          limit: 50,
        },
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const properties = useMemo(
    () => propertiesQ.data?.pages.flatMap((page) => page.items) ?? [],
    [propertiesQ.data],
  );
  const municipalities = useMemo(
    () => new Set(properties.map((property: any) => property.municipality).filter(Boolean)).size,
    [properties],
  );
  const activeFilters = [municipality, projectType, minPrice, maxPrice].filter(Boolean).length;

  const clearFilters = () => {
    setMunicipality("");
    setProjectType("");
    setMinPrice("");
    setMaxPrice("");
  };

  return (
    <>
      <PageHeader
        eyebrow="Shared property record"
        title="Properties"
        subtitle="Find every property your team has reviewed, then open its deals, Permit cases, files, contacts, tasks, and history in one place."
        actions={
          <Button size="sm" onClick={() => setEditorOpen(true)}>
            <Plus className="mr-1.5 size-4" /> Add property
          </Button>
        }
      />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Properties loaded" value={properties.length} />
          <SummaryCard label="Municipalities loaded" value={municipalities} />
          <SummaryCard label="Workspace" value={activeWorkspace?.name ?? "Personal"} text />
        </div>

        <Card className="surface-editorial p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search address, owner, broker, zoning, notes, city, or project type"
                aria-label="Search property history"
              />
            </div>
            <Button
              variant={showFilters || activeFilters ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
            >
              <SlidersHorizontal className="mr-1.5 size-4" />
              Filters{activeFilters ? ` (${activeFilters})` : ""}
            </Button>
            <Button
              variant={includeArchived ? "secondary" : "outline"}
              size="sm"
              onClick={() => setIncludeArchived((value) => !value)}
              aria-pressed={includeArchived}
            >
              {includeArchived ? "Including archived" : "Show archived"}
            </Button>
          </div>
          {showFilters && (
            <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-5">
              <Input
                value={municipality}
                onChange={(event) => setMunicipality(event.target.value)}
                placeholder="Municipality"
                aria-label="Filter by municipality"
              />
              <Select
                value={projectType || "all"}
                onValueChange={(value) => setProjectType(value === "all" ? "" : value)}
              >
                <SelectTrigger aria-label="Filter by project type">
                  <SelectValue placeholder="Project type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All project types</SelectItem>
                  {PROPERTY_PROJECT_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                inputMode="decimal"
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="Minimum price"
                aria-label="Minimum price"
              />
              <Input
                inputMode="decimal"
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="Maximum price"
                aria-label="Maximum price"
              />
              <Button variant="ghost" onClick={clearFilters} disabled={!activeFilters}>
                Clear filters
              </Button>
            </div>
          )}
        </Card>

        {propertiesQ.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading properties">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-60 rounded-xl" />
            ))}
          </div>
        ) : propertiesQ.isError ? (
          <Card className="surface-editorial p-8 text-center">
            <h2 className="font-semibold">Properties could not be loaded</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {propertiesQ.error instanceof Error ? propertiesQ.error.message : "Unknown error"}
            </p>
            <Button className="mt-4" variant="outline" onClick={() => propertiesQ.refetch()}>
              Try again
            </Button>
          </Card>
        ) : properties.length ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {properties.map((property: any) => (
                <Link
                  key={property.id}
                  to="/properties/$propertyId"
                  params={{ propertyId: property.id }}
                  className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Card className="surface-editorial h-full p-5 transition-colors group-hover:border-primary/35">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                          <Building2 className="size-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="truncate font-semibold">{propertyTitle(property)}</h2>
                          {property.building_name &&
                            property.building_name !== propertyTitle(property) && (
                              <p className="truncate text-xs text-muted-foreground">
                                {property.building_name}
                              </p>
                            )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {property.archived_at && <Badge variant="outline">Archived</Badge>}
                        {matchLabel(property.match_scope) && (
                          <Badge variant="secondary">{matchLabel(property.match_scope)}</Badge>
                        )}
                        {!property.archived_at &&
                          !matchLabel(property.match_scope) &&
                          property.project_type && (
                            <Badge variant="outline" className="max-w-32 truncate">
                              {propertyProjectTypeLabel(property.project_type)}
                            </Badge>
                          )}
                      </div>
                    </div>
                    <div className="mt-5 space-y-3 text-sm">
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <MapPin className="mt-0.5 size-4 shrink-0" />
                        <span>{propertyAddress(property) || "Address not recorded"}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 border-y border-border py-3">
                        <PropertyFact label="Price" value={propertyPrice(property)} />
                        <PropertyFact
                          label="Zoning"
                          value={property.zoning_designation || "Not recorded"}
                        />
                      </div>
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <UserRound className="mt-0.5 size-4 shrink-0" />
                        <span>
                          {[property.owner_name, property.broker_name]
                            .filter(Boolean)
                            .join(" · ") || "Owner and broker not recorded"}
                        </span>
                      </div>
                    </div>
                    <p className="mt-5 text-xs text-muted-foreground">
                      Updated {new Date(property.updated_at).toLocaleDateString("en-CA")}
                    </p>
                  </Card>
                </Link>
              ))}
            </div>
            {propertiesQ.hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  disabled={propertiesQ.isFetchingNextPage}
                  onClick={() => propertiesQ.fetchNextPage()}
                >
                  {propertiesQ.isFetchingNextPage
                    ? "Loading older properties…"
                    : "Load older properties"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <Card className="surface-editorial p-14 text-center">
            <Building2 className="mx-auto size-8 text-muted-foreground/50" />
            <h2 className="mt-3 font-medium">
              {query || activeFilters ? "No matches" : "No properties yet"}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {query || activeFilters
                ? "Try a different fragment or clear the structured filters."
                : "Add the first property once, then connect every deal, Permit case, file, contact, and task to it."}
            </p>
            {!query && !activeFilters && (
              <Button className="mt-5" onClick={() => setEditorOpen(true)}>
                <Plus className="mr-1.5 size-4" /> Add property
              </Button>
            )}
          </Card>
        )}
      </PageBody>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        {editorOpen && (
          <PropertyEditor
            workspaceId={workspaceId}
            onCancel={() => setEditorOpen(false)}
            onSaved={() => {
              setEditorOpen(false);
              qc.invalidateQueries({ queryKey: ["properties"] });
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function SummaryCard({
  label,
  value,
  text,
}: {
  label: string;
  value: number | string;
  text?: boolean;
}) {
  return (
    <Card className="surface-editorial p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={text ? "mt-2 truncate text-lg font-semibold" : "num mt-2 text-2xl"}>
        {value}
      </div>
    </Card>
  );
}

function PropertyFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}
