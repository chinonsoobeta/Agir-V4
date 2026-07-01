import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader, PageBody } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import { listProjects } from "@/lib/projects.functions";
import {
  linkContactToDeal,
  listRelationshipContacts,
  saveRelationshipContact,
} from "@/lib/operating-depth.functions";
import { Building2, CalendarClock, Link2, Mail, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type ProjectRow = Tables<"projects">;
type DealLink = Pick<
  Tables<"deal_relationships">,
  "id" | "project_id" | "contact_id" | "role" | "influence"
> & { projects: { name: string } | null };
type RelationshipContact = Tables<"relationship_contacts"> & { deals: DealLink[] };

export const Route = createFileRoute("/_authenticated/relationships")({
  head: () => ({ meta: [{ title: "Relationships | Agir" }] }),
  component: RelationshipsPage,
});

const TYPES = [
  "broker",
  "lender",
  "investor",
  "operator",
  "attorney",
  "consultant",
  "seller",
  "tenant",
  "other",
] as const;

function RelationshipsPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.personal ? null : activeWorkspace?.id;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const contactsQ = useQuery({
    queryKey: ["relationships", workspaceId],
    queryFn: () => listRelationshipContacts({ data: { workspace_id: workspaceId } }),
  });
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => listProjects() });
  const contacts = useMemo<RelationshipContact[]>(
    () => (contactsQ.data ?? []) as RelationshipContact[],
    [contactsQ.data],
  );
  const filtered = useMemo(() => {
    const needle = search.toLowerCase().trim();
    if (!needle) return contacts;
    return contacts.filter((contact) =>
      [contact.full_name, contact.company, contact.title, contact.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [contacts, search]);
  const overdue = contacts.filter(
    (contact) =>
      contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < Date.now(),
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Relationship intelligence"
        title="Relationships"
        subtitle="Keep brokers, lenders, investors, operators, and advisors connected to active opportunities."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4 mr-1.5" /> Add contact
              </Button>
            </DialogTrigger>
            <ContactDialog workspaceId={workspaceId} onClose={() => setOpen(false)} />
          </Dialog>
        }
      />
      <PageBody>
        <div className="grid sm:grid-cols-3 gap-3">
          <Stat label="Relationships" value={contacts.length} icon={Users} />
          <Stat
            label="Strategic"
            value={contacts.filter((contact: any) => contact.strength === "strategic").length}
            icon={Building2}
          />
          <Stat label="Follow-ups due" value={overdue} icon={CalendarClock} warning={overdue > 0} />
        </div>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people or companies"
          />
        </div>
        {filtered.length ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((contact: any) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                projects={projectsQ.data ?? []}
                workspaceId={workspaceId}
              />
            ))}
          </div>
        ) : (
          <Card className="p-14 text-center elevated">
            <Users className="size-8 mx-auto text-muted-foreground/50" />
            <div className="font-medium mt-3">No relationships found</div>
            <p className="text-sm text-muted-foreground mt-1">
              Add a contact to begin building institutional relationship memory.
            </p>
          </Card>
        )}
      </PageBody>
    </>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  warning,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  warning?: boolean;
}) {
  return (
    <Card className="p-4 elevated">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</span>
        <Icon className={`size-4 ${warning ? "text-warning" : "text-primary"}`} />
      </div>
      <div className={`num text-2xl mt-2 ${warning ? "text-warning" : ""}`}>{value}</div>
    </Card>
  );
}

function ContactCard({
  contact,
  projects,
  workspaceId,
}: {
  contact: any;
  projects: any[];
  workspaceId: string | null | undefined;
}) {
  const qc = useQueryClient();
  const linkFn = useServerFn(linkContactToDeal);
  const [projectId, setProjectId] = useState("");
  const link = useMutation({
    mutationFn: () =>
      linkFn({
        data: {
          project_id: projectId,
          contact_id: contact.id,
          role: contact.relationship_type,
          influence: "medium",
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["relationships", workspaceId] });
      setProjectId("");
      toast.success("Contact linked to deal");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const followUpDue =
    contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < Date.now();

  return (
    <Card className="p-5 elevated">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold truncate">{contact.full_name}</div>
          <div className="text-sm text-muted-foreground truncate">
            {[contact.title, contact.company].filter(Boolean).join(" · ") || "Independent"}
          </div>
        </div>
        <Badge variant="outline" className="capitalize shrink-0">
          {contact.strength}
        </Badge>
      </div>
      <div className="mt-4 space-y-2 text-xs text-muted-foreground">
        <div className="capitalize">{contact.relationship_type}</div>
        {contact.email && (
          <a
            className="flex items-center gap-2 hover:text-primary"
            href={`mailto:${contact.email}`}
          >
            <Mail className="size-3.5" /> {contact.email}
          </a>
        )}
        {contact.next_follow_up_at && (
          <div className={`flex items-center gap-2 ${followUpDue ? "text-warning" : ""}`}>
            <CalendarClock className="size-3.5" />
            Follow up {new Date(contact.next_follow_up_at).toLocaleDateString()}
          </div>
        )}
      </div>
      {contact.deals?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {contact.deals.map((deal: any) => (
            <Link key={deal.id} to="/projects/$id" params={{ id: deal.project_id }}>
              <Badge variant="secondary">{deal.projects?.name ?? "Deal"}</Badge>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="Link to deal" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          disabled={!projectId || link.isPending}
          onClick={() => link.mutate()}
        >
          <Link2 className="size-3.5" />
        </Button>
      </div>
    </Card>
  );
}

function ContactDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string | null | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveRelationshipContact);
  const [form, setForm] = useState({
    full_name: "",
    company: "",
    title: "",
    email: "",
    relationship_type: "broker",
    strength: "developing",
    next_follow_up_at: "",
  });
  const mutation = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...form,
          workspace_id: workspaceId,
          next_follow_up_at: form.next_follow_up_at || null,
        } as any,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["relationships", workspaceId] });
      toast.success("Relationship added");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add relationship</DialogTitle>
      </DialogHeader>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Label>Full name</Label>
          <Input
            value={form.full_name}
            onChange={(event) => setForm({ ...form, full_name: event.target.value })}
          />
        </div>
        <div>
          <Label>Company</Label>
          <Input
            value={form.company}
            onChange={(event) => setForm({ ...form, company: event.target.value })}
          />
        </div>
        <div>
          <Label>Title</Label>
          <Input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Email</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </div>
        <div>
          <Label>Type</Label>
          <Select
            value={form.relationship_type}
            onValueChange={(value) => setForm({ ...form, relationship_type: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((type) => (
                <SelectItem key={type} value={type} className="capitalize">
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Strength</Label>
          <Select
            value={form.strength}
            onValueChange={(value) => setForm({ ...form, strength: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["new", "developing", "strong", "strategic"].map((value) => (
                <SelectItem key={value} value={value} className="capitalize">
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Next follow-up</Label>
          <Input
            type="date"
            value={form.next_follow_up_at}
            onChange={(event) => setForm({ ...form, next_follow_up_at: event.target.value })}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!form.full_name.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Add relationship
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
