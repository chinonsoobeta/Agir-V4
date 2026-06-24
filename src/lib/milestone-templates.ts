// Reusable execution checklists. Applying a template creates a coherent set of
// milestones for a deal in one click — no developer/admin involvement. Due dates
// are offsets from "today" in days (operational defaults, clearly editable after
// they are created). These are workflow items, not financial values.

export type MilestoneTemplateItem = {
  title: string;
  category: "diligence" | "financing" | "legal" | "closing";
  priority: "low" | "medium" | "high" | "critical";
  offsetDays: number;
};

export type MilestoneTemplate = {
  id: string;
  name: string;
  description: string;
  items: MilestoneTemplateItem[];
};

export const MILESTONE_TEMPLATES: MilestoneTemplate[] = [
  {
    id: "acquisition_diligence",
    name: "Acquisition diligence",
    description: "Standard third-party diligence workstream for an acquisition.",
    items: [
      {
        title: "Kick off diligence & retain advisors",
        category: "diligence",
        priority: "high",
        offsetDays: 3,
      },
      {
        title: "Title commitment & survey ordered",
        category: "legal",
        priority: "high",
        offsetDays: 10,
      },
      { title: "Environmental Phase I", category: "diligence", priority: "high", offsetDays: 21 },
      {
        title: "Property condition assessment",
        category: "diligence",
        priority: "medium",
        offsetDays: 21,
      },
      { title: "Lease / rent-roll audit", category: "diligence", priority: "high", offsetDays: 18 },
      {
        title: "Diligence findings memo to IC",
        category: "diligence",
        priority: "critical",
        offsetDays: 30,
      },
    ],
  },
  {
    id: "financing_close",
    name: "Financing close",
    description: "Debt placement from term sheet to funding conditions.",
    items: [
      {
        title: "Lender term sheet executed",
        category: "financing",
        priority: "high",
        offsetDays: 7,
      },
      { title: "Appraisal ordered", category: "financing", priority: "medium", offsetDays: 14 },
      {
        title: "Loan application package submitted",
        category: "financing",
        priority: "high",
        offsetDays: 21,
      },
      { title: "Rate lock", category: "financing", priority: "critical", offsetDays: 35 },
      {
        title: "Closing conditions cleared",
        category: "financing",
        priority: "critical",
        offsetDays: 45,
      },
    ],
  },
  {
    id: "legal_closing",
    name: "Legal & closing",
    description: "Purchase agreement through funding and recording.",
    items: [
      {
        title: "Purchase & sale agreement executed",
        category: "legal",
        priority: "critical",
        offsetDays: 5,
      },
      { title: "Title objections resolved", category: "legal", priority: "high", offsetDays: 20 },
      {
        title: "Closing checklist circulated",
        category: "closing",
        priority: "high",
        offsetDays: 40,
      },
      {
        title: "Settlement statement approved",
        category: "closing",
        priority: "critical",
        offsetDays: 47,
      },
      { title: "Funding & recording", category: "closing", priority: "critical", offsetDays: 50 },
    ],
  },
];

export function milestoneTemplate(id: string): MilestoneTemplate | undefined {
  return MILESTONE_TEMPLATES.find((t) => t.id === id);
}

/** Expand a template into createMilestone payloads for one deal, dated from `now`. */
export function expandTemplate(
  templateId: string,
  projectId: string,
  now: Date,
): {
  project_id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  due_date: string;
}[] {
  const tpl = milestoneTemplate(templateId);
  if (!tpl) return [];
  return tpl.items.map((it) => {
    const due = new Date(now.getTime() + it.offsetDays * 86_400_000);
    return {
      project_id: projectId,
      title: it.title,
      category: it.category,
      priority: it.priority,
      status: "not_started",
      due_date: due.toISOString().slice(0, 10),
    };
  });
}
