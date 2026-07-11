import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  createPermitCase,
  PROJECT_CONTEXTS,
  PROPERTY_TYPES,
  WORK_TYPES,
} from "@/lib/permit-cases.functions";
import { useWorkspace } from "@/lib/workspace-context";
import { PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/permits/address-autocomplete";
export const Route = createFileRoute("/_authenticated/permits/new")({ component: NewPermitCase });
const cats = [
  "Structural work",
  "Plumbing",
  "Electrical",
  "Mechanical/HVAC",
  "Fire/life safety",
  "Excavation or shoring",
  "Tree removal",
  "Heritage property",
  "Environmental work",
  "Change of occupancy or use",
  "Site servicing",
  "Utility connection or relocation",
  "Transportation or access work",
  "Signage",
  "Other",
  "I’m not sure",
];
const pretty = (s: string) => s.replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase());
function NewPermitCase() {
  const router = useRouter(),
    { activeWorkspace } = useWorkspace();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<any>({
    name: "",
    property_address: "",
    municipality: "",
    municipality_confirmed: false,
    province: "British Columbia",
    property_type: null,
    work_type: null,
    project_context: null,
    work_categories: [],
    description: "",
    existing_use: "",
    proposed_use: "",
    known_conditions: "",
    zoning_source_kind: "unknown",
  });
  const create = useMutation({
    mutationFn: () =>
      createPermitCase({
        data: {
          ...form,
          municipality: form.municipality || null,
          property_address: form.property_address || null,
          workspace_id: activeWorkspace?.name === "Personal workspace" ? null : activeWorkspace?.id,
        },
      }),
    onSuccess: (c: any) => router.navigate({ to: "/permits/$caseId", params: { caseId: c.id } }),
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <>
      <PageHeader
        eyebrow="Permits"
        title="Start a permit project"
        subtitle={`Step ${step} of 4: incomplete facts can remain unknown.`}
      />
      <PageBody className="mx-auto max-w-3xl">
        <Card className="p-5 sm:p-7">
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Property</h2>
              <Field label="Case name" required>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Property address">
                <AddressAutocomplete
                  value={form.property_address}
                  onChange={(v) =>
                    setForm((f: any) => ({
                      ...f,
                      property_address: v,
                      municipality_confirmed: false,
                    }))
                  }
                  onSelect={(s) =>
                    setForm((f: any) => ({
                      ...f,
                      property_address: s.address,
                      municipality: s.municipality ?? f.municipality,
                      province: s.province ?? f.province,
                      municipality_confirmed: false,
                    }))
                  }
                  placeholder="Start typing to see suggestions…"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Suggestions are provided by OpenStreetMap through Photon. Your typed address is
                  sent to that service. Suggested municipalities remain unconfirmed and provide no
                  zoning evidence.
                </p>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Municipality">
                  <Input
                    value={form.municipality}
                    onChange={(e) => set("municipality", e.target.value)}
                  />
                </Field>
                <Field label="Province">
                  <Input value={form.province} onChange={(e) => set("province", e.target.value)} />
                </Field>
              </div>
              <label className="flex min-h-11 items-center gap-3">
                <Checkbox
                  checked={form.municipality_confirmed}
                  onCheckedChange={(v) => set("municipality_confirmed", v === true)}
                />
                I have confirmed this municipality
              </label>
              <Choice
                label="Property type"
                value={form.property_type}
                options={PROPERTY_TYPES}
                onChange={(v) => set("property_type", v)}
              />
              <p className="text-sm text-muted-foreground">
                Zoning change analysis not yet available. Zoning is not inferred from the address.
              </p>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Proposed work</h2>
              <Choice
                label="Type of work"
                value={form.work_type}
                options={WORK_TYPES}
                onChange={(v) => set("work_type", v)}
              />
              <Choice
                label="Project scale or context"
                value={form.project_context}
                options={PROJECT_CONTEXTS}
                onChange={(v) => set("project_context", v)}
              />
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Work categories</legend>
                <div className="grid sm:grid-cols-2">
                  {cats.map((c) => (
                    <label key={c} className="flex min-h-11 items-center gap-3 text-sm">
                      <Checkbox
                        checked={form.work_categories.includes(c)}
                        onCheckedChange={(v) =>
                          set(
                            "work_categories",
                            v
                              ? [...form.work_categories, c]
                              : form.work_categories.filter((x: string) => x !== c),
                          )
                        }
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Description and known facts</h2>
              <Field label="Brief project description">
                <Textarea
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Existing use">
                  <Input
                    value={form.existing_use}
                    onChange={(e) => set("existing_use", e.target.value)}
                  />
                </Field>
                <Field label="Proposed use">
                  <Input
                    value={form.proposed_use}
                    onChange={(e) => set("proposed_use", e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Known building or site conditions">
                <Textarea
                  value={form.known_conditions}
                  onChange={(e) => set("known_conditions", e.target.value)}
                />
              </Field>
              <p className="rounded-md border p-3 text-sm">
                These are user-provided facts until supported by a linked document or authoritative
                source.
              </p>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Review</h2>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Summary k="Case" v={form.name} />
                <Summary k="Address" v={form.property_address || "Unknown"} />
                <Summary
                  k="Municipality"
                  v={form.municipality_confirmed ? form.municipality : "Unconfirmed"}
                />
                <Summary k="Work" v={form.work_type ? pretty(form.work_type) : "Unknown"} />
                <Summary
                  k="Property"
                  v={form.property_type ? pretty(form.property_type) : "Unknown"}
                />
                <Summary k="Zoning" v="Unknown: no verified analysis" />
              </dl>
              <p className="rounded-md bg-muted p-3 text-sm">
                Creating this case does not create an underwriting deal or confirm any permit
                requirement.
              </p>
              {create.error && (
                <p role="alert" className="text-sm text-destructive">
                  {(create.error as Error).message}
                </p>
              )}
            </div>
          )}
          <div className="mt-7 flex justify-between">
            <Button variant="outline" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
            {step < 4 ? (
              <Button
                disabled={step === 1 && !form.name.trim()}
                onClick={() => setStep((s) => s + 1)}
              >
                Continue
              </Button>
            ) : (
              <Button
                disabled={create.isPending || !form.name.trim()}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Creating…" : "Create permit case"}
              </Button>
            )}
          </div>
        </Card>
      </PageBody>
    </>
  );
}
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Label className="block">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <div className="mt-2">{children}</div>
    </Label>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Not sure / unknown" />
        </SelectTrigger>
        <SelectContent>
          {options.map((x) => (
            <SelectItem key={x} value={x}>
              {pretty(x)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
function Summary({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
