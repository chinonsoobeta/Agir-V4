import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AddressAutocomplete } from "@/components/permits/address-autocomplete";
import { saveProperty, type SavePropertyInput } from "@/lib/properties.functions";
import { propertyProjectTypeOptions } from "@/lib/property-project-types";
import { Button } from "@/components/ui/button";
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type EditableProperty = Partial<SavePropertyInput> & { id?: string };
const NO_PROJECT_TYPE = "__none__";

const emptyProperty = (workspaceId: string | null): EditableProperty => ({
  workspace_id: workspaceId,
  address_line_1: "",
  country_code: "CA",
  currency: "CAD",
  place_provider: "manual",
});

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function PropertyEditor({
  property,
  workspaceId,
  onSaved,
  onCancel,
}: {
  property?: EditableProperty;
  workspaceId: string | null;
  onSaved: (property: any) => void;
  onCancel: () => void;
}) {
  const initial = useMemo(
    () => ({ ...emptyProperty(workspaceId), ...(property ?? {}) }),
    [property, workspaceId],
  );
  const [draft, setDraft] = useState<EditableProperty>(initial);
  const [error, setError] = useState<string | null>(null);
  const projectTypeOptions = useMemo(
    () => propertyProjectTypeOptions(draft.project_type),
    [draft.project_type],
  );
  const saveFn = useServerFn(saveProperty);
  const set = (key: keyof EditableProperty, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const address = draft.address_line_1?.trim();
      if (!address) throw new Error("Street address is required.");
      return saveFn({
        data: {
          id: draft.id,
          workspace_id: workspaceId,
          display_name: nullable(draft.display_name ?? ""),
          building_name: nullable(draft.building_name ?? ""),
          address_line_1: address,
          address_line_2: nullable(draft.address_line_2 ?? ""),
          unit: nullable(draft.unit ?? ""),
          municipality: nullable(draft.municipality ?? ""),
          region: nullable(draft.region ?? ""),
          postal_code: nullable(draft.postal_code ?? ""),
          country_code: draft.country_code || "CA",
          place_provider: draft.place_provider || "manual",
          provider_place_id: nullable(draft.provider_place_id ?? ""),
          latitude: draft.latitude ?? null,
          longitude: draft.longitude ?? null,
          zoning_designation: nullable(draft.zoning_designation ?? ""),
          zoning_source_url: nullable(draft.zoning_source_url ?? ""),
          zoning_verified_at: draft.zoning_verified_at || null,
          zoning_evidence: draft.zoning_evidence ?? null,
          price: draft.price ?? null,
          currency: draft.currency || "CAD",
          owner_name: nullable(draft.owner_name ?? ""),
          broker_name: nullable(draft.broker_name ?? ""),
          project_type: nullable(draft.project_type ?? ""),
          notes: nullable(draft.notes ?? ""),
        },
      });
    },
    onSuccess: (row) => {
      toast.success(property?.id ? "Property updated" : "Property added");
      onSaved(row);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  return (
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{property?.id ? "Edit property" : "Add property"}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Property name" description="A short internal name, if useful.">
          <Input
            value={draft.display_name ?? ""}
            onChange={(event) => set("display_name", event.target.value)}
            placeholder="Cedar Quay"
          />
        </Field>
        <Field label="Building or complex">
          <Input
            value={draft.building_name ?? ""}
            onChange={(event) => set("building_name", event.target.value)}
            placeholder="Harbour Centre"
          />
        </Field>
        <Field
          label="Street address"
          required
          description="Search by street or building. Changing the address clears location-specific zoning evidence."
          error={!draft.address_line_1?.trim() ? error : null}
        >
          {(props) => (
            <AddressAutocomplete
              {...props}
              value={draft.address_line_1 ?? ""}
              onChange={(value) => {
                setDraft((current) => ({
                  ...current,
                  address_line_1: value,
                  building_name: current.place_provider === "manual" ? current.building_name : null,
                  place_provider: "manual",
                  provider_place_id: null,
                  latitude: null,
                  longitude: null,
                  municipality: null,
                  region: null,
                  postal_code: null,
                  zoning_designation: null,
                  zoning_source_url: null,
                  zoning_verified_at: null,
                  zoning_evidence: null,
                }));
                setError(null);
              }}
              onSelect={(selection) =>
                setDraft((current) => ({
                  ...current,
                  address_line_1: selection.addressLine1,
                  building_name: selection.buildingName ?? current.building_name,
                  municipality: selection.municipality ?? current.municipality,
                  region: selection.province ?? current.region,
                  postal_code: selection.postalCode ?? current.postal_code,
                  place_provider: selection.provider,
                  provider_place_id: selection.placeId,
                  latitude: selection.latitude,
                  longitude: selection.longitude,
                }))
              }
              placeholder="Search an address or building name"
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Address line 2">
            <Input
              value={draft.address_line_2 ?? ""}
              onChange={(event) => set("address_line_2", event.target.value)}
              placeholder="Tower or floor"
            />
          </Field>
          <Field label="Unit or suite">
            <Input
              value={draft.unit ?? ""}
              onChange={(event) => set("unit", event.target.value)}
              placeholder="1204"
            />
          </Field>
        </div>
        <Field label="Municipality">
          <Input
            value={draft.municipality ?? ""}
            onChange={(event) => set("municipality", event.target.value)}
            autoComplete="address-level2"
            placeholder="City of Vancouver"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Province">
            <Input
              value={draft.region ?? ""}
              onChange={(event) => set("region", event.target.value)}
              autoComplete="address-level1"
              placeholder="BC"
            />
          </Field>
          <Field label="Postal code">
            <Input
              value={draft.postal_code ?? ""}
              onChange={(event) => set("postal_code", event.target.value)}
              autoComplete="postal-code"
              placeholder="V6B 4N6"
            />
          </Field>
        </div>
        <Field label="Project type">
          {(props) => (
            <Select
              value={draft.project_type || NO_PROJECT_TYPE}
              onValueChange={(value) =>
                set("project_type", value === NO_PROJECT_TYPE ? null : value)
              }
            >
              <SelectTrigger {...props}>
                <SelectValue placeholder="Select a project type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT_TYPE}>Not categorized</SelectItem>
                {projectTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Price">
          {(props) => (
            <div className="grid grid-cols-[1fr_6.5rem] gap-2">
              <Input
                {...props}
                inputMode="decimal"
                value={draft.price ?? ""}
                onChange={(event) => set("price", numberOrNull(event.target.value))}
                placeholder="25000000"
              />
              <Select
                value={draft.currency || "CAD"}
                onValueChange={(value) => set("currency", value)}
              >
                <SelectTrigger aria-label="Currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </Field>
        <Field label="Owner">
          <Input
            value={draft.owner_name ?? ""}
            onChange={(event) => set("owner_name", event.target.value)}
            placeholder="Current owner"
          />
        </Field>
        <Field label="Broker">
          <Input
            value={draft.broker_name ?? ""}
            onChange={(event) => set("broker_name", event.target.value)}
            placeholder="Broker or brokerage"
          />
        </Field>
        <Field label="Zoning">
          <Input
            value={draft.zoning_designation ?? ""}
            onChange={(event) => set("zoning_designation", event.target.value)}
            placeholder="CD-1"
          />
        </Field>
        <Field label="Zoning source URL">
          <Input
            type="url"
            value={draft.zoning_source_url ?? ""}
            onChange={(event) => set("zoning_source_url", event.target.value)}
            placeholder="https://…"
          />
        </Field>
        <Field label="Zoning last checked">
          <Input
            type="date"
            value={draft.zoning_verified_at?.slice(0, 10) ?? ""}
            onChange={(event) =>
              set(
                "zoning_verified_at",
                event.target.value ? `${event.target.value}T12:00:00.000Z` : null,
              )
            }
          />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            rows={5}
            value={draft.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
            placeholder="What matters about this property?"
          />
        </Field>
      </div>

      {error && draft.address_line_1?.trim() && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : property?.id ? "Save changes" : "Add property"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
