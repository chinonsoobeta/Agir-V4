import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addDealComment,
  assignDealMember,
  listDealCollaboration,
} from "@/lib/operating-depth.functions";
import { MessageSquare, Send, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type CollaborationProfile = Pick<Tables<"profiles">, "full_name" | "email"> | null;
type CommentRow = Tables<"deal_comments"> & { profile: CollaborationProfile };
type AssignmentRow = Tables<"deal_assignments"> & { profile: CollaborationProfile };
type MemberRow = Pick<Tables<"workspace_members">, "id" | "user_id" | "role"> & {
  profile: CollaborationProfile;
};

function displayName(profile: CollaborationProfile) {
  return profile?.full_name || profile?.email || "Team member";
}

export function DealCollaboration({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [memberId, setMemberId] = useState("");
  const [responsibility, setResponsibility] = useState("deal_team");
  const query = useQuery({
    queryKey: ["deal-collaboration", projectId],
    queryFn: () => listDealCollaboration({ data: { project_id: projectId } }),
  });
  const addFn = useServerFn(addDealComment);
  const assignFn = useServerFn(assignDealMember);
  const add = useMutation({
    mutationFn: () => addFn({ data: { project_id: projectId, body: comment, mentions: [] } }),
    onSuccess: () => {
      setComment("");
      qc.invalidateQueries({ queryKey: ["deal-collaboration", projectId] });
      qc.invalidateQueries({ queryKey: ["timeline", projectId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const assign = useMutation({
    mutationFn: () =>
      assignFn({
        data: { project_id: projectId, user_id: memberId, responsibility },
      }),
    onSuccess: () => {
      setMemberId("");
      qc.invalidateQueries({ queryKey: ["deal-collaboration", projectId] });
      toast.success("Team member assigned");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const data = query.data ?? { comments: [], assignments: [], members: [] };

  return (
    <div className="grid lg:grid-cols-[1fr_22rem] gap-5">
      <Card className="p-5 elevated">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-primary" />
          <h2 className="font-semibold">Deal discussion</h2>
        </div>
        <div className="mt-4 flex gap-2">
          <Input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Share an update, question, or decision context"
            onKeyDown={(event) => {
              if (event.key === "Enter" && comment.trim()) add.mutate();
            }}
          />
          <Button
            size="icon"
            disabled={!comment.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            <Send className="size-4" />
          </Button>
        </div>
        <div className="mt-5 space-y-3">
          {data.comments.length ? (
            data.comments.map((item: CommentRow) => (
              <div key={item.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold">{displayName(item.profile)}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm mt-1.5 whitespace-pre-wrap">{item.body}</p>
              </div>
            ))
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No discussion yet. Add the first update.
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="p-5 elevated">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            <h2 className="font-semibold">Deal team</h2>
          </div>
          <div className="mt-4 space-y-2">
            {data.assignments.map((assignment: AssignmentRow) => (
              <div key={assignment.id} className="rounded-md border border-border p-2.5">
                <div className="text-sm font-medium">{displayName(assignment.profile)}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {assignment.responsibility.replaceAll("_", " ")}
                </div>
              </div>
            ))}
            {!data.assignments.length && (
              <p className="text-xs text-muted-foreground">No team assignments yet.</p>
            )}
          </div>
        </Card>
        {data.members.length > 0 && (
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="size-4 text-primary" />
              <h2 className="font-semibold">Assign teammate</h2>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Person</Label>
                <Select value={memberId} onValueChange={setMemberId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select member" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.members.map((member: MemberRow) => (
                      <SelectItem key={member.user_id} value={member.user_id}>
                        {displayName(member.profile)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Responsibility</Label>
                <Select value={responsibility} onValueChange={setResponsibility}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deal_lead">Deal lead</SelectItem>
                    <SelectItem value="underwriting">Underwriting</SelectItem>
                    <SelectItem value="diligence">Due diligence</SelectItem>
                    <SelectItem value="legal">Legal</SelectItem>
                    <SelectItem value="financing">Financing</SelectItem>
                    <SelectItem value="deal_team">Deal team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                disabled={!memberId || assign.isPending}
                onClick={() => assign.mutate()}
              >
                Assign
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
