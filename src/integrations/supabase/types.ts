export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          activity_type: string;
          created_at: string;
          description: string | null;
          id: string;
          project_id: string | null;
          user_id: string;
        };
        Insert: {
          activity_type: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          project_id?: string | null;
          user_id: string;
        };
        Update: {
          activity_type?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          project_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activities_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      assumption_comments: {
        Row: {
          assumption_id: string;
          comment: string;
          created_at: string;
          id: string;
          owner_id: string;
          user_id: string;
          user_name: string | null;
        };
        Insert: {
          assumption_id: string;
          comment: string;
          created_at?: string;
          id?: string;
          owner_id: string;
          user_id: string;
          user_name?: string | null;
        };
        Update: {
          assumption_id?: string;
          comment?: string;
          created_at?: string;
          id?: string;
          owner_id?: string;
          user_id?: string;
          user_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "assumption_comments_assumption_id_fkey";
            columns: ["assumption_id"];
            isOneToOne: false;
            referencedRelation: "assumptions";
            referencedColumns: ["id"];
          },
        ];
      };
      assumption_history: {
        Row: {
          created_at: string;
          field_name: string;
          id: string;
          new_value: string | null;
          previous_value: string | null;
          project_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          field_name: string;
          id?: string;
          new_value?: string | null;
          previous_value?: string | null;
          project_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          field_name?: string;
          id?: string;
          new_value?: string | null;
          previous_value?: string | null;
          project_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assumption_history_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      assumption_versions: {
        Row: {
          assumption_id: string;
          change_reason: string | null;
          changed_by: string;
          changed_by_name: string | null;
          confidence_band: Database["public"]["Enums"]["confidence_band"] | null;
          confidence_score: number | null;
          created_at: string;
          id: string;
          owner_id: string;
          source_document_id: string | null;
          source_text: string | null;
          status: Database["public"]["Enums"]["assumption_status"];
          value_numeric: number | null;
          value_text: string | null;
          version_number: number;
        };
        Insert: {
          assumption_id: string;
          change_reason?: string | null;
          changed_by: string;
          changed_by_name?: string | null;
          confidence_band?: Database["public"]["Enums"]["confidence_band"] | null;
          confidence_score?: number | null;
          created_at?: string;
          id?: string;
          owner_id: string;
          source_document_id?: string | null;
          source_text?: string | null;
          status: Database["public"]["Enums"]["assumption_status"];
          value_numeric?: number | null;
          value_text?: string | null;
          version_number: number;
        };
        Update: {
          assumption_id?: string;
          change_reason?: string | null;
          changed_by?: string;
          changed_by_name?: string | null;
          confidence_band?: Database["public"]["Enums"]["confidence_band"] | null;
          confidence_score?: number | null;
          created_at?: string;
          id?: string;
          owner_id?: string;
          source_document_id?: string | null;
          source_text?: string | null;
          status?: Database["public"]["Enums"]["assumption_status"];
          value_numeric?: number | null;
          value_text?: string | null;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "assumption_versions_assumption_id_fkey";
            columns: ["assumption_id"];
            isOneToOne: false;
            referencedRelation: "assumptions";
            referencedColumns: ["id"];
          },
        ];
      };
      assumptions: {
        Row: {
          ai_reasoning: string | null;
          approved_at: string | null;
          approved_by: string | null;
          category: string | null;
          confidence_band: Database["public"]["Enums"]["confidence_band"];
          confidence_score: number;
          conflict_values: Json | null;
          created_at: string;
          current_version: number;
          dual_control_pending: boolean;
          field_key: string;
          field_label: string;
          formula_text: string | null;
          id: string;
          impact_amount: number | null;
          impact_rank: number | null;
          override_reason: string | null;
          owner_id: string;
          project_id: string;
          requires_dual_control: boolean;
          second_approval_at: string | null;
          second_approval_by: string | null;
          second_approver_name: string | null;
          source_document_id: string | null;
          source_location: string | null;
          source_text: string | null;
          status: Database["public"]["Enums"]["assumption_status"];
          unit: string | null;
          updated_at: string;
          value_numeric: number | null;
          value_text: string | null;
        };
        Insert: {
          ai_reasoning?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          category?: string | null;
          confidence_band?: Database["public"]["Enums"]["confidence_band"];
          confidence_score?: number;
          conflict_values?: Json | null;
          created_at?: string;
          current_version?: number;
          dual_control_pending?: boolean;
          field_key: string;
          field_label: string;
          formula_text?: string | null;
          id?: string;
          impact_amount?: number | null;
          impact_rank?: number | null;
          override_reason?: string | null;
          owner_id: string;
          project_id: string;
          requires_dual_control?: boolean;
          second_approval_at?: string | null;
          second_approval_by?: string | null;
          second_approver_name?: string | null;
          source_document_id?: string | null;
          source_location?: string | null;
          source_text?: string | null;
          status?: Database["public"]["Enums"]["assumption_status"];
          unit?: string | null;
          updated_at?: string;
          value_numeric?: number | null;
          value_text?: string | null;
        };
        Update: {
          ai_reasoning?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          category?: string | null;
          confidence_band?: Database["public"]["Enums"]["confidence_band"];
          confidence_score?: number;
          conflict_values?: Json | null;
          created_at?: string;
          current_version?: number;
          dual_control_pending?: boolean;
          field_key?: string;
          field_label?: string;
          formula_text?: string | null;
          id?: string;
          impact_amount?: number | null;
          impact_rank?: number | null;
          override_reason?: string | null;
          owner_id?: string;
          project_id?: string;
          requires_dual_control?: boolean;
          second_approval_at?: string | null;
          second_approval_by?: string | null;
          second_approver_name?: string | null;
          source_document_id?: string | null;
          source_location?: string | null;
          source_text?: string | null;
          status?: Database["public"]["Enums"]["assumption_status"];
          unit?: string | null;
          updated_at?: string;
          value_numeric?: number | null;
          value_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "assumptions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assumptions_source_document_id_fkey";
            columns: ["source_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_chain_verifications: {
        Row: {
          checked_at: string;
          checked_by: string;
          head_hash: string | null;
          id: string;
          project_id: string | null;
          reason: string | null;
          total: number;
          valid: boolean;
          workspace_id: string | null;
        };
        Insert: {
          checked_at?: string;
          checked_by?: string;
          head_hash?: string | null;
          id?: string;
          project_id?: string | null;
          reason?: string | null;
          total?: number;
          valid: boolean;
          workspace_id?: string | null;
        };
        Update: {
          checked_at?: string;
          checked_by?: string;
          head_hash?: string | null;
          id?: string;
          project_id?: string | null;
          reason?: string | null;
          total?: number;
          valid?: boolean;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_chain_verifications_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_chain_verifications_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          owner_id: string;
          payload: Json | null;
          prev_hash: string | null;
          project_id: string | null;
          row_hash: string | null;
          seq: number | null;
          user_id: string;
          user_name: string | null;
          workspace_id: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          owner_id: string;
          payload?: Json | null;
          prev_hash?: string | null;
          project_id?: string | null;
          row_hash?: string | null;
          seq?: number | null;
          user_id: string;
          user_name?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          owner_id?: string;
          payload?: Json | null;
          prev_hash?: string | null;
          project_id?: string | null;
          row_hash?: string | null;
          seq?: number | null;
          user_id?: string;
          user_name?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      authoritative_land_data_sources: {
        Row: {
          boundary_notes: string | null;
          created_at: string;
          id: string;
          integration_status: string;
          jurisdiction_id: string;
          last_verified_at: string | null;
          licensing_status: string;
          reviewed_by: string | null;
          source_name: string;
          source_type: string;
          source_url: string;
          update_frequency: string | null;
          updated_at: string;
        };
        Insert: {
          boundary_notes?: string | null;
          created_at?: string;
          id?: string;
          integration_status?: string;
          jurisdiction_id: string;
          last_verified_at?: string | null;
          licensing_status?: string;
          reviewed_by?: string | null;
          source_name: string;
          source_type: string;
          source_url: string;
          update_frequency?: string | null;
          updated_at?: string;
        };
        Update: {
          boundary_notes?: string | null;
          created_at?: string;
          id?: string;
          integration_status?: string;
          jurisdiction_id?: string;
          last_verified_at?: string | null;
          licensing_status?: string;
          reviewed_by?: string | null;
          source_name?: string;
          source_type?: string;
          source_url?: string;
          update_frequency?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "authoritative_land_data_sources_jurisdiction_id_fkey";
            columns: ["jurisdiction_id"];
            isOneToOne: false;
            referencedRelation: "jurisdictions";
            referencedColumns: ["id"];
          },
        ];
      };
      cash_flows: {
        Row: {
          amount: number;
          computed_at: string;
          id: string;
          line_key: Database["public"]["Enums"]["cash_flow_line_key"];
          owner_id: string;
          period_year: number;
          project_id: string;
          run_id: string | null;
          scenario_key: string;
        };
        Insert: {
          amount: number;
          computed_at?: string;
          id?: string;
          line_key: Database["public"]["Enums"]["cash_flow_line_key"];
          owner_id: string;
          period_year: number;
          project_id: string;
          run_id?: string | null;
          scenario_key?: string;
        };
        Update: {
          amount?: number;
          computed_at?: string;
          id?: string;
          line_key?: Database["public"]["Enums"]["cash_flow_line_key"];
          owner_id?: string;
          period_year?: number;
          project_id?: string;
          run_id?: string | null;
          scenario_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cash_flows_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_flows_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      compliance_enforcement_runs: {
        Row: {
          evidence: Json;
          finished_at: string;
          id: string;
          run_by: string;
          run_type: string;
          started_at: string;
          status: string;
          summary: string;
          workspace_id: string | null;
        };
        Insert: {
          evidence?: Json;
          finished_at?: string;
          id?: string;
          run_by?: string;
          run_type: string;
          started_at?: string;
          status: string;
          summary: string;
          workspace_id?: string | null;
        };
        Update: {
          evidence?: Json;
          finished_at?: string;
          id?: string;
          run_by?: string;
          run_type?: string;
          started_at?: string;
          status?: string;
          summary?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "compliance_enforcement_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      data_governance_requests: {
        Row: {
          completed_at: string | null;
          created_at: string;
          due_at: string;
          evidence_url: string | null;
          id: string;
          metadata: Json;
          reason: string | null;
          request_type: string;
          requester_id: string;
          status: string;
          subject: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          due_at?: string;
          evidence_url?: string | null;
          id?: string;
          metadata?: Json;
          reason?: string | null;
          request_type: string;
          requester_id: string;
          status?: string;
          subject: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          due_at?: string;
          evidence_url?: string | null;
          id?: string;
          metadata?: Json;
          reason?: string | null;
          request_type?: string;
          requester_id?: string;
          status?: string;
          subject?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "data_governance_requests_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      deal_assignments: {
        Row: {
          assigned_by: string;
          created_at: string;
          id: string;
          project_id: string;
          responsibility: string;
          user_id: string;
        };
        Insert: {
          assigned_by: string;
          created_at?: string;
          id?: string;
          project_id: string;
          responsibility?: string;
          user_id: string;
        };
        Update: {
          assigned_by?: string;
          created_at?: string;
          id?: string;
          project_id?: string;
          responsibility?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deal_assignments_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      deal_comments: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          mentions: string[];
          project_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          mentions?: string[];
          project_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          mentions?: string[];
          project_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deal_comments_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      deal_milestones: {
        Row: {
          assigned_to: string | null;
          category: string;
          completed_at: string | null;
          created_at: string;
          depends_on: string[];
          due_date: string | null;
          id: string;
          notes: string | null;
          owner_id: string;
          priority: string;
          project_id: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          category?: string;
          completed_at?: string | null;
          created_at?: string;
          depends_on?: string[];
          due_date?: string | null;
          id?: string;
          notes?: string | null;
          owner_id: string;
          priority?: string;
          project_id: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          category?: string;
          completed_at?: string | null;
          created_at?: string;
          depends_on?: string[];
          due_date?: string | null;
          id?: string;
          notes?: string | null;
          owner_id?: string;
          priority?: string;
          project_id?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deal_milestones_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      deal_relationships: {
        Row: {
          contact_id: string;
          created_at: string;
          id: string;
          influence: string;
          owner_id: string;
          project_id: string;
          role: string | null;
        };
        Insert: {
          contact_id: string;
          created_at?: string;
          id?: string;
          influence?: string;
          owner_id: string;
          project_id: string;
          role?: string | null;
        };
        Update: {
          contact_id?: string;
          created_at?: string;
          id?: string;
          influence?: string;
          owner_id?: string;
          project_id?: string;
          role?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "deal_relationships_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "relationship_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deal_relationships_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      decision_logs: {
        Row: {
          conditions: string | null;
          created_at: string;
          decision: Database["public"]["Enums"]["ic_decision"];
          id: string;
          owner_id: string;
          project_id: string;
          rationale: string | null;
          run_id: string | null;
          user_id: string;
          user_name: string | null;
        };
        Insert: {
          conditions?: string | null;
          created_at?: string;
          decision: Database["public"]["Enums"]["ic_decision"];
          id?: string;
          owner_id: string;
          project_id: string;
          rationale?: string | null;
          run_id?: string | null;
          user_id: string;
          user_name?: string | null;
        };
        Update: {
          conditions?: string | null;
          created_at?: string;
          decision?: Database["public"]["Enums"]["ic_decision"];
          id?: string;
          owner_id?: string;
          project_id?: string;
          rationale?: string | null;
          run_id?: string | null;
          user_id?: string;
          user_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "decision_logs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "decision_logs_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      development_budget: {
        Row: {
          amount: number;
          category: Database["public"]["Enums"]["development_budget_category"];
          confidence: number | null;
          created_at: string;
          id: string;
          label: string;
          owner_id: string;
          project_id: string;
          source: Database["public"]["Enums"]["assumption_source_kind"];
          source_document_id: string | null;
          source_text: string | null;
          status: Database["public"]["Enums"]["engine_input_status"];
          updated_at: string;
        };
        Insert: {
          amount: number;
          category: Database["public"]["Enums"]["development_budget_category"];
          confidence?: number | null;
          created_at?: string;
          id?: string;
          label: string;
          owner_id: string;
          project_id: string;
          source?: Database["public"]["Enums"]["assumption_source_kind"];
          source_document_id?: string | null;
          source_text?: string | null;
          status?: Database["public"]["Enums"]["engine_input_status"];
          updated_at?: string;
        };
        Update: {
          amount?: number;
          category?: Database["public"]["Enums"]["development_budget_category"];
          confidence?: number | null;
          created_at?: string;
          id?: string;
          label?: string;
          owner_id?: string;
          project_id?: string;
          source?: Database["public"]["Enums"]["assumption_source_kind"];
          source_document_id?: string | null;
          source_text?: string | null;
          status?: Database["public"]["Enums"]["engine_input_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "development_budget_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "development_budget_source_document_id_fkey";
            columns: ["source_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          ai_assumptions: string | null;
          ai_risks: string | null;
          ai_summary: string | null;
          category: string | null;
          content_hash: string | null;
          extraction_error: string | null;
          extraction_status: string;
          file_type: string | null;
          id: string;
          name: string;
          ocr_confidence: number | null;
          owner_id: string;
          page_count: number | null;
          project_id: string | null;
          scan_detail: string | null;
          scan_status: string;
          size_bytes: number | null;
          status: string;
          storage_path: string;
          upload_date: string;
        };
        Insert: {
          ai_assumptions?: string | null;
          ai_risks?: string | null;
          ai_summary?: string | null;
          category?: string | null;
          content_hash?: string | null;
          extraction_error?: string | null;
          extraction_status?: string;
          file_type?: string | null;
          id?: string;
          name: string;
          ocr_confidence?: number | null;
          owner_id: string;
          page_count?: number | null;
          project_id?: string | null;
          scan_detail?: string | null;
          scan_status?: string;
          size_bytes?: number | null;
          status?: string;
          storage_path: string;
          upload_date?: string;
        };
        Update: {
          ai_assumptions?: string | null;
          ai_risks?: string | null;
          ai_summary?: string | null;
          category?: string | null;
          content_hash?: string | null;
          extraction_error?: string | null;
          extraction_status?: string;
          file_type?: string | null;
          id?: string;
          name?: string;
          ocr_confidence?: number | null;
          owner_id?: string;
          page_count?: number | null;
          project_id?: string | null;
          scan_detail?: string | null;
          scan_status?: string;
          size_bytes?: number | null;
          status?: string;
          storage_path?: string;
          upload_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      external_record_links: {
        Row: {
          connection_id: string;
          created_at: string;
          direction: string;
          external_id: string;
          id: string;
          last_synced_at: string;
          owner_id: string;
          project_id: string | null;
        };
        Insert: {
          connection_id: string;
          created_at?: string;
          direction?: string;
          external_id: string;
          id?: string;
          last_synced_at?: string;
          owner_id: string;
          project_id?: string | null;
        };
        Update: {
          connection_id?: string;
          created_at?: string;
          direction?: string;
          external_id?: string;
          id?: string;
          last_synced_at?: string;
          owner_id?: string;
          project_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "external_record_links_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "integration_connections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "external_record_links_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      extraction_jobs: {
        Row: {
          attempts: number;
          cancellation_requested: boolean;
          created_at: string;
          dead_lettered_at: string | null;
          document_id: string | null;
          error: string | null;
          finished_at: string | null;
          heartbeat_at: string | null;
          id: string;
          idempotency_key: string;
          kind: string;
          lease_expires_at: string | null;
          lease_owner: string | null;
          max_attempts: number;
          message: string | null;
          owner_id: string;
          pending_upload_id: string | null;
          priority: number;
          progress: number;
          project_id: string | null;
          result_json: Json | null;
          scheduled_at: string;
          started_at: string | null;
          status: string;
          total: number | null;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          cancellation_requested?: boolean;
          created_at?: string;
          dead_lettered_at?: string | null;
          document_id?: string | null;
          error?: string | null;
          finished_at?: string | null;
          heartbeat_at?: string | null;
          id?: string;
          idempotency_key: string;
          kind: string;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          max_attempts?: number;
          message?: string | null;
          owner_id: string;
          pending_upload_id?: string | null;
          priority?: number;
          progress?: number;
          project_id?: string | null;
          result_json?: Json | null;
          scheduled_at?: string;
          started_at?: string | null;
          status?: string;
          total?: number | null;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          cancellation_requested?: boolean;
          created_at?: string;
          dead_lettered_at?: string | null;
          document_id?: string | null;
          error?: string | null;
          finished_at?: string | null;
          heartbeat_at?: string | null;
          id?: string;
          idempotency_key?: string;
          kind?: string;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          max_attempts?: number;
          message?: string | null;
          owner_id?: string;
          pending_upload_id?: string | null;
          priority?: number;
          progress?: number;
          project_id?: string | null;
          result_json?: Json | null;
          scheduled_at?: string;
          started_at?: string | null;
          status?: string;
          total?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "extraction_jobs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extraction_jobs_pending_upload_id_fkey";
            columns: ["pending_upload_id"];
            isOneToOne: false;
            referencedRelation: "pending_document_uploads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extraction_jobs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      financial_outputs: {
        Row: {
          computed_at: string;
          formula_text: string | null;
          id: string;
          inputs: Json | null;
          metric_key: string;
          metric_label: string | null;
          owner_id: string;
          project_id: string;
          run_id: string | null;
          scenario_key: string;
          unit: string | null;
          value_numeric: number | null;
        };
        Insert: {
          computed_at?: string;
          formula_text?: string | null;
          id?: string;
          inputs?: Json | null;
          metric_key: string;
          metric_label?: string | null;
          owner_id: string;
          project_id: string;
          run_id?: string | null;
          scenario_key?: string;
          unit?: string | null;
          value_numeric?: number | null;
        };
        Update: {
          computed_at?: string;
          formula_text?: string | null;
          id?: string;
          inputs?: Json | null;
          metric_key?: string;
          metric_label?: string | null;
          owner_id?: string;
          project_id?: string;
          run_id?: string | null;
          scenario_key?: string;
          unit?: string | null;
          value_numeric?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "financial_outputs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "financial_outputs_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      generated_reports: {
        Row: {
          content_json: Json;
          created_at: string;
          generated_at: string;
          id: string;
          input_fingerprint: string | null;
          output_fingerprint: string | null;
          owner_id: string;
          project_id: string;
          report_type: string;
          run_id: string | null;
          run_mode: string | null;
          run_number: number | null;
          status: string;
          title: string | null;
          verification_report: Json | null;
        };
        Insert: {
          content_json: Json;
          created_at?: string;
          generated_at?: string;
          id?: string;
          input_fingerprint?: string | null;
          output_fingerprint?: string | null;
          owner_id: string;
          project_id: string;
          report_type: string;
          run_id?: string | null;
          run_mode?: string | null;
          run_number?: number | null;
          status?: string;
          title?: string | null;
          verification_report?: Json | null;
        };
        Update: {
          content_json?: Json;
          created_at?: string;
          generated_at?: string;
          id?: string;
          input_fingerprint?: string | null;
          output_fingerprint?: string | null;
          owner_id?: string;
          project_id?: string;
          report_type?: string;
          run_id?: string | null;
          run_mode?: string | null;
          run_number?: number | null;
          status?: string;
          title?: string | null;
          verification_report?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "generated_reports_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_reports_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      ic_conditions: {
        Row: {
          created_at: string;
          id: string;
          label: string;
          owner_id: string;
          project_id: string;
          satisfied_at: string | null;
          satisfied_by: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          label: string;
          owner_id: string;
          project_id: string;
          satisfied_at?: string | null;
          satisfied_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string;
          owner_id?: string;
          project_id?: string;
          satisfied_at?: string | null;
          satisfied_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ic_conditions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      ic_votes: {
        Row: {
          created_at: string;
          id: string;
          owner_id: string;
          project_id: string;
          rationale: string | null;
          updated_at: string;
          vote: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          owner_id: string;
          project_id: string;
          rationale?: string | null;
          updated_at?: string;
          vote: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          owner_id?: string;
          project_id?: string;
          rationale?: string | null;
          updated_at?: string;
          vote?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ic_votes_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_connections: {
        Row: {
          category: string;
          config: Json;
          created_at: string;
          display_name: string;
          id: string;
          last_synced_at: string | null;
          owner_id: string;
          provider: string;
          status: string;
          updated_at: string;
          workspace_id: string | null;
        };
        Insert: {
          category: string;
          config?: Json;
          created_at?: string;
          display_name: string;
          id?: string;
          last_synced_at?: string | null;
          owner_id: string;
          provider: string;
          status?: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Update: {
          category?: string;
          config?: Json;
          created_at?: string;
          display_name?: string;
          id?: string;
          last_synced_at?: string | null;
          owner_id?: string;
          provider?: string;
          status?: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "integration_connections_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_sync_runs: {
        Row: {
          completed_at: string | null;
          connection_id: string;
          direction: string;
          error_summary: string | null;
          id: string;
          metadata: Json;
          owner_id: string;
          records_failed: number;
          records_read: number;
          records_written: number;
          started_at: string;
          status: string;
          workspace_id: string | null;
        };
        Insert: {
          completed_at?: string | null;
          connection_id: string;
          direction?: string;
          error_summary?: string | null;
          id?: string;
          metadata?: Json;
          owner_id: string;
          records_failed?: number;
          records_read?: number;
          records_written?: number;
          started_at?: string;
          status?: string;
          workspace_id?: string | null;
        };
        Update: {
          completed_at?: string | null;
          connection_id?: string;
          direction?: string;
          error_summary?: string | null;
          id?: string;
          metadata?: Json;
          owner_id?: string;
          records_failed?: number;
          records_read?: number;
          records_written?: number;
          started_at?: string;
          status?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "integration_sync_runs_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "integration_connections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "integration_sync_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      investment_memos: {
        Row: {
          content: Json;
          created_at: string;
          id: string;
          owner_id: string;
          project_id: string;
          run_id: string | null;
          status: string | null;
          verification_report: Json | null;
        };
        Insert: {
          content: Json;
          created_at?: string;
          id?: string;
          owner_id: string;
          project_id: string;
          run_id?: string | null;
          status?: string | null;
          verification_report?: Json | null;
        };
        Update: {
          content?: Json;
          created_at?: string;
          id?: string;
          owner_id?: string;
          project_id?: string;
          run_id?: string | null;
          status?: string | null;
          verification_report?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "investment_memos_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "investment_memos_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      jurisdictions: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          jurisdiction_type: string;
          last_verified_at: string | null;
          name: string;
          official_url: string;
          permit_portal_url: string | null;
          province: string;
          regional_area: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          jurisdiction_type: string;
          last_verified_at?: string | null;
          name: string;
          official_url: string;
          permit_portal_url?: string | null;
          province: string;
          regional_area?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          jurisdiction_type?: string;
          last_verified_at?: string | null;
          name?: string;
          official_url?: string;
          permit_portal_url?: string | null;
          province?: string;
          regional_area?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      market_signals: {
        Row: {
          created_at: string;
          id: string;
          market: string;
          metric: string;
          observed_at: string;
          owner_id: string;
          period: string | null;
          source: string | null;
          trend: string;
          unit: string;
          value_numeric: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          market: string;
          metric: string;
          observed_at?: string;
          owner_id: string;
          period?: string | null;
          source?: string | null;
          trend?: string;
          unit?: string;
          value_numeric: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          market?: string;
          metric?: string;
          observed_at?: string;
          owner_id?: string;
          period?: string | null;
          source?: string | null;
          trend?: string;
          unit?: string;
          value_numeric?: number;
        };
        Relationships: [];
      };
      memo_snapshots: {
        Row: {
          assumptions_json: Json;
          content_hash: string;
          created_at: string;
          created_by: string;
          created_by_name: string | null;
          decision_id: string | null;
          id: string;
          memo_id: string | null;
          outputs_json: Json;
          owner_id: string;
          project_id: string;
          report_json: Json;
          run_id: string | null;
          verdict_code: string | null;
          version: number;
        };
        Insert: {
          assumptions_json: Json;
          content_hash: string;
          created_at?: string;
          created_by: string;
          created_by_name?: string | null;
          decision_id?: string | null;
          id?: string;
          memo_id?: string | null;
          outputs_json: Json;
          owner_id: string;
          project_id: string;
          report_json: Json;
          run_id?: string | null;
          verdict_code?: string | null;
          version: number;
        };
        Update: {
          assumptions_json?: Json;
          content_hash?: string;
          created_at?: string;
          created_by?: string;
          created_by_name?: string | null;
          decision_id?: string | null;
          id?: string;
          memo_id?: string | null;
          outputs_json?: Json;
          owner_id?: string;
          project_id?: string;
          report_json?: Json;
          run_id?: string | null;
          verdict_code?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "memo_snapshots_decision_id_fkey";
            columns: ["decision_id"];
            isOneToOne: false;
            referencedRelation: "decision_logs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memo_snapshots_memo_id_fkey";
            columns: ["memo_id"];
            isOneToOne: false;
            referencedRelation: "investment_memos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memo_snapshots_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memo_snapshots_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          action_url: string | null;
          body: string | null;
          created_at: string;
          id: string;
          kind: string;
          project_id: string | null;
          read_at: string | null;
          recipient_id: string;
          title: string;
        };
        Insert: {
          action_url?: string | null;
          body?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          project_id?: string | null;
          read_at?: string | null;
          recipient_id: string;
          title: string;
        };
        Update: {
          action_url?: string | null;
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          project_id?: string | null;
          read_at?: string | null;
          recipient_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      onboarding_events: {
        Row: {
          created_at: string;
          event_name: string;
          id: string;
          metadata: Json;
          step_key: string | null;
          user_id: string;
          workspace_id: string | null;
        };
        Insert: {
          created_at?: string;
          event_name: string;
          id?: string;
          metadata?: Json;
          step_key?: string | null;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          created_at?: string;
          event_name?: string;
          id?: string;
          metadata?: Json;
          step_key?: string | null;
          user_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "onboarding_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      pending_document_uploads: {
        Row: {
          category: string | null;
          created_at: string;
          document_id: string | null;
          expected_content_type: string | null;
          expected_size_bytes: number;
          expires_at: string;
          failure_reason: string | null;
          file_name: string;
          finalized_at: string | null;
          id: string;
          object_path: string;
          owner_id: string;
          project_id: string | null;
          status: string;
          updated_at: string;
          workspace_id: string | null;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          document_id?: string | null;
          expected_content_type?: string | null;
          expected_size_bytes: number;
          expires_at: string;
          failure_reason?: string | null;
          file_name: string;
          finalized_at?: string | null;
          id?: string;
          object_path: string;
          owner_id: string;
          project_id?: string | null;
          status?: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          document_id?: string | null;
          expected_content_type?: string | null;
          expected_size_bytes?: number;
          expires_at?: string;
          failure_reason?: string | null;
          file_name?: string;
          finalized_at?: string | null;
          id?: string;
          object_path?: string;
          owner_id?: string;
          project_id?: string | null;
          status?: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pending_document_uploads_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pending_document_uploads_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pending_document_uploads_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      permit_documents: {
        Row: {
          created_at: string;
          document_id: string;
          document_role: string;
          is_received: boolean;
          is_required: boolean;
          notes: string | null;
          permit_id: string;
          received_at: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          document_id: string;
          document_role?: string;
          is_received?: boolean;
          is_required?: boolean;
          notes?: string | null;
          permit_id: string;
          received_at?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          document_id?: string;
          document_role?: string;
          is_received?: boolean;
          is_required?: boolean;
          notes?: string | null;
          permit_id?: string;
          received_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "permit_documents_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_documents_permit_id_fkey";
            columns: ["permit_id"];
            isOneToOne: false;
            referencedRelation: "project_permits";
            referencedColumns: ["id"];
          },
        ];
      };
      permit_extraction_candidates: {
        Row: {
          authority_name: string | null;
          candidate_name: string;
          confidence_score: number | null;
          created_at: string;
          description: string | null;
          document_id: string;
          extraction_version: string;
          id: string;
          jurisdiction_id: string | null;
          owner_id: string;
          permit_type: string | null;
          processing_duration_days: number | null;
          processing_duration_text: string | null;
          project_id: string;
          project_permit_id: string | null;
          review_reason: string | null;
          review_status: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source_location: string;
          source_text: string;
          updated_at: string;
        };
        Insert: {
          authority_name?: string | null;
          candidate_name: string;
          confidence_score?: number | null;
          created_at?: string;
          description?: string | null;
          document_id: string;
          extraction_version: string;
          id?: string;
          jurisdiction_id?: string | null;
          owner_id: string;
          permit_type?: string | null;
          processing_duration_days?: number | null;
          processing_duration_text?: string | null;
          project_id: string;
          project_permit_id?: string | null;
          review_reason?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_location: string;
          source_text: string;
          updated_at?: string;
        };
        Update: {
          authority_name?: string | null;
          candidate_name?: string;
          confidence_score?: number | null;
          created_at?: string;
          description?: string | null;
          document_id?: string;
          extraction_version?: string;
          id?: string;
          jurisdiction_id?: string | null;
          owner_id?: string;
          permit_type?: string | null;
          processing_duration_days?: number | null;
          processing_duration_text?: string | null;
          project_id?: string;
          project_permit_id?: string | null;
          review_reason?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_location?: string;
          source_text?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "permit_extraction_candidates_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_extraction_candidates_jurisdiction_id_fkey";
            columns: ["jurisdiction_id"];
            isOneToOne: false;
            referencedRelation: "jurisdictions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_extraction_candidates_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_extraction_candidates_project_permit_id_fkey";
            columns: ["project_permit_id"];
            isOneToOne: false;
            referencedRelation: "project_permits";
            referencedColumns: ["id"];
          },
        ];
      };
      permit_history: {
        Row: {
          change_reason: string | null;
          changed_at: string;
          changed_by: string;
          id: string;
          new_applicability_status: string | null;
          new_status: string | null;
          previous_applicability_status: string | null;
          previous_status: string | null;
          project_permit_id: string;
          source_document_id: string | null;
          source_text: string | null;
        };
        Insert: {
          change_reason?: string | null;
          changed_at?: string;
          changed_by: string;
          id?: string;
          new_applicability_status?: string | null;
          new_status?: string | null;
          previous_applicability_status?: string | null;
          previous_status?: string | null;
          project_permit_id: string;
          source_document_id?: string | null;
          source_text?: string | null;
        };
        Update: {
          change_reason?: string | null;
          changed_at?: string;
          changed_by?: string;
          id?: string;
          new_applicability_status?: string | null;
          new_status?: string | null;
          previous_applicability_status?: string | null;
          previous_status?: string | null;
          project_permit_id?: string;
          source_document_id?: string | null;
          source_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "permit_history_project_permit_id_fkey";
            columns: ["project_permit_id"];
            isOneToOne: false;
            referencedRelation: "project_permits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_history_source_document_id_fkey";
            columns: ["source_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      permit_requirements: {
        Row: {
          created_at: string;
          description: string | null;
          document_id: string | null;
          due_date: string | null;
          id: string;
          is_required: boolean;
          name: string;
          notes: string | null;
          project_permit_id: string;
          requirement_type: string;
          source_document_id: string | null;
          source_text: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          document_id?: string | null;
          due_date?: string | null;
          id?: string;
          is_required?: boolean;
          name: string;
          notes?: string | null;
          project_permit_id: string;
          requirement_type?: string;
          source_document_id?: string | null;
          source_text?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          document_id?: string | null;
          due_date?: string | null;
          id?: string;
          is_required?: boolean;
          name?: string;
          notes?: string | null;
          project_permit_id?: string;
          requirement_type?: string;
          source_document_id?: string | null;
          source_text?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "permit_requirements_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_requirements_project_permit_id_fkey";
            columns: ["project_permit_id"];
            isOneToOne: false;
            referencedRelation: "project_permits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_requirements_source_document_id_fkey";
            columns: ["source_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      permit_rule_reviews: {
        Row: {
          created_at: string;
          id: string;
          next_review_at: string | null;
          notes: string | null;
          permit_rule_id: string;
          review_status: string;
          reviewed_at: string;
          reviewer_id: string | null;
          source_content_hash: string | null;
          source_text: string | null;
          source_title: string | null;
          source_url: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          next_review_at?: string | null;
          notes?: string | null;
          permit_rule_id: string;
          review_status: string;
          reviewed_at?: string;
          reviewer_id?: string | null;
          source_content_hash?: string | null;
          source_text?: string | null;
          source_title?: string | null;
          source_url: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          next_review_at?: string | null;
          notes?: string | null;
          permit_rule_id?: string;
          review_status?: string;
          reviewed_at?: string;
          reviewer_id?: string | null;
          source_content_hash?: string | null;
          source_text?: string | null;
          source_title?: string | null;
          source_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "permit_rule_reviews_permit_rule_id_fkey";
            columns: ["permit_rule_id"];
            isOneToOne: false;
            referencedRelation: "permit_rule_review_queue";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_rule_reviews_permit_rule_id_fkey";
            columns: ["permit_rule_id"];
            isOneToOne: false;
            referencedRelation: "permit_rules";
            referencedColumns: ["id"];
          },
        ];
      };
      permit_rules: {
        Row: {
          applicability_conditions: string | null;
          application_url: string | null;
          authority_scope: string;
          created_at: string;
          description: string | null;
          effective_date: string | null;
          id: string;
          jurisdiction_id: string;
          name: string;
          next_review_at: string | null;
          official_source_url: string | null;
          permit_type: string;
          published_duration_days: number | null;
          published_duration_text: string | null;
          required_documents: Json;
          review_date: string | null;
          reviewed_by: string | null;
          rule_version: string;
          source_content_hash: string | null;
          source_document_id: string | null;
          source_text: string | null;
          source_title: string | null;
          superseded_at: string | null;
          supersedes_rule_id: string | null;
          updated_at: string;
          verification_status: string;
        };
        Insert: {
          applicability_conditions?: string | null;
          application_url?: string | null;
          authority_scope?: string;
          created_at?: string;
          description?: string | null;
          effective_date?: string | null;
          id?: string;
          jurisdiction_id: string;
          name: string;
          next_review_at?: string | null;
          official_source_url?: string | null;
          permit_type: string;
          published_duration_days?: number | null;
          published_duration_text?: string | null;
          required_documents?: Json;
          review_date?: string | null;
          reviewed_by?: string | null;
          rule_version: string;
          source_content_hash?: string | null;
          source_document_id?: string | null;
          source_text?: string | null;
          source_title?: string | null;
          superseded_at?: string | null;
          supersedes_rule_id?: string | null;
          updated_at?: string;
          verification_status: string;
        };
        Update: {
          applicability_conditions?: string | null;
          application_url?: string | null;
          authority_scope?: string;
          created_at?: string;
          description?: string | null;
          effective_date?: string | null;
          id?: string;
          jurisdiction_id?: string;
          name?: string;
          next_review_at?: string | null;
          official_source_url?: string | null;
          permit_type?: string;
          published_duration_days?: number | null;
          published_duration_text?: string | null;
          required_documents?: Json;
          review_date?: string | null;
          reviewed_by?: string | null;
          rule_version?: string;
          source_content_hash?: string | null;
          source_document_id?: string | null;
          source_text?: string | null;
          source_title?: string | null;
          superseded_at?: string | null;
          supersedes_rule_id?: string | null;
          updated_at?: string;
          verification_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "permit_rules_jurisdiction_id_fkey";
            columns: ["jurisdiction_id"];
            isOneToOne: false;
            referencedRelation: "jurisdictions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_rules_source_document_id_fkey";
            columns: ["source_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_rules_supersedes_rule_id_fkey";
            columns: ["supersedes_rule_id"];
            isOneToOne: false;
            referencedRelation: "permit_rule_review_queue";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permit_rules_supersedes_rule_id_fkey";
            columns: ["supersedes_rule_id"];
            isOneToOne: false;
            referencedRelation: "permit_rules";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_permits: {
        Row: {
          applicability_status: string;
          application_date: string | null;
          application_url: string | null;
          confidence_band: string | null;
          confidence_score: number | null;
          created_at: string;
          description: string | null;
          duration_source: string | null;
          expiration_date: string | null;
          id: string;
          is_required: boolean | null;
          issued_date: string | null;
          jurisdiction_id: string | null;
          name: string;
          notes: string | null;
          owner_id: string;
          permit_rule_id: string | null;
          permit_type: string;
          processing_duration_days: number | null;
          processing_duration_text: string | null;
          project_id: string;
          required_reason: string | null;
          responsible_party: string | null;
          source_document_id: string | null;
          source_kind: string;
          source_location: string | null;
          source_text: string | null;
          target_date: string | null;
          updated_at: string;
          workflow_status: string;
        };
        Insert: {
          applicability_status?: string;
          application_date?: string | null;
          application_url?: string | null;
          confidence_band?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          description?: string | null;
          duration_source?: string | null;
          expiration_date?: string | null;
          id?: string;
          is_required?: boolean | null;
          issued_date?: string | null;
          jurisdiction_id?: string | null;
          name: string;
          notes?: string | null;
          owner_id: string;
          permit_rule_id?: string | null;
          permit_type: string;
          processing_duration_days?: number | null;
          processing_duration_text?: string | null;
          project_id: string;
          required_reason?: string | null;
          responsible_party?: string | null;
          source_document_id?: string | null;
          source_kind?: string;
          source_location?: string | null;
          source_text?: string | null;
          target_date?: string | null;
          updated_at?: string;
          workflow_status?: string;
        };
        Update: {
          applicability_status?: string;
          application_date?: string | null;
          application_url?: string | null;
          confidence_band?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          description?: string | null;
          duration_source?: string | null;
          expiration_date?: string | null;
          id?: string;
          is_required?: boolean | null;
          issued_date?: string | null;
          jurisdiction_id?: string | null;
          name?: string;
          notes?: string | null;
          owner_id?: string;
          permit_rule_id?: string | null;
          permit_type?: string;
          processing_duration_days?: number | null;
          processing_duration_text?: string | null;
          project_id?: string;
          required_reason?: string | null;
          responsible_party?: string | null;
          source_document_id?: string | null;
          source_kind?: string;
          source_location?: string | null;
          source_text?: string | null;
          target_date?: string | null;
          updated_at?: string;
          workflow_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_permits_jurisdiction_id_fkey";
            columns: ["jurisdiction_id"];
            isOneToOne: false;
            referencedRelation: "jurisdictions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_permits_permit_rule_id_fkey";
            columns: ["permit_rule_id"];
            isOneToOne: false;
            referencedRelation: "permit_rule_review_queue";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_permits_permit_rule_id_fkey";
            columns: ["permit_rule_id"];
            isOneToOne: false;
            referencedRelation: "permit_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_permits_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_permits_source_document_id_fkey";
            columns: ["source_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          acquisition_cost: number | null;
          completion_date: string | null;
          construction_cost: number | null;
          created_at: string;
          deal_type: Database["public"]["Enums"]["deal_type"];
          debt_amount: number | null;
          equity_amount: number | null;
          id: string;
          interest_rate: number | null;
          lead_owner: string | null;
          location: string | null;
          municipality: string | null;
          name: string;
          notes: string | null;
          owner_id: string;
          permit_project_type: string | null;
          probability: number;
          project_description: string | null;
          property_address: string | null;
          property_type: string | null;
          revenue_forecast: number | null;
          source: string | null;
          start_date: string | null;
          status: Database["public"]["Enums"]["project_status"];
          target_close_date: string | null;
          type: Database["public"]["Enums"]["project_type"];
          updated_at: string;
          work_categories: string[];
          workspace_id: string | null;
          zoning_designation: string | null;
          zoning_source: string | null;
          zoning_verified_at: string | null;
        };
        Insert: {
          acquisition_cost?: number | null;
          completion_date?: string | null;
          construction_cost?: number | null;
          created_at?: string;
          deal_type?: Database["public"]["Enums"]["deal_type"];
          debt_amount?: number | null;
          equity_amount?: number | null;
          id?: string;
          interest_rate?: number | null;
          lead_owner?: string | null;
          location?: string | null;
          municipality?: string | null;
          name: string;
          notes?: string | null;
          owner_id: string;
          permit_project_type?: string | null;
          probability?: number;
          project_description?: string | null;
          property_address?: string | null;
          property_type?: string | null;
          revenue_forecast?: number | null;
          source?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          target_close_date?: string | null;
          type?: Database["public"]["Enums"]["project_type"];
          updated_at?: string;
          work_categories?: string[];
          workspace_id?: string | null;
          zoning_designation?: string | null;
          zoning_source?: string | null;
          zoning_verified_at?: string | null;
        };
        Update: {
          acquisition_cost?: number | null;
          completion_date?: string | null;
          construction_cost?: number | null;
          created_at?: string;
          deal_type?: Database["public"]["Enums"]["deal_type"];
          debt_amount?: number | null;
          equity_amount?: number | null;
          id?: string;
          interest_rate?: number | null;
          lead_owner?: string | null;
          location?: string | null;
          municipality?: string | null;
          name?: string;
          notes?: string | null;
          owner_id?: string;
          permit_project_type?: string | null;
          probability?: number;
          project_description?: string | null;
          property_address?: string | null;
          property_type?: string | null;
          revenue_forecast?: number | null;
          source?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          target_close_date?: string | null;
          type?: Database["public"]["Enums"]["project_type"];
          updated_at?: string;
          work_categories?: string[];
          workspace_id?: string | null;
          zoning_designation?: string | null;
          zoning_source?: string | null;
          zoning_verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_events: {
        Row: {
          bucket: string;
          cost: number;
          created_at: string;
          id: string;
          metadata: Json;
          owner_id: string;
          workspace_id: string | null;
        };
        Insert: {
          bucket: string;
          cost?: number;
          created_at?: string;
          id?: string;
          metadata?: Json;
          owner_id: string;
          workspace_id?: string | null;
        };
        Update: {
          bucket?: string;
          cost?: number;
          created_at?: string;
          id?: string;
          metadata?: Json;
          owner_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "rate_limit_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      reconciliation_flags: {
        Row: {
          actual: number | null;
          check_key: string;
          created_at: string;
          expected: number | null;
          id: string;
          message: string;
          owner_id: string;
          project_id: string;
          resolved: boolean;
          run_id: string | null;
          severity: Database["public"]["Enums"]["reconciliation_severity"];
        };
        Insert: {
          actual?: number | null;
          check_key: string;
          created_at?: string;
          expected?: number | null;
          id?: string;
          message: string;
          owner_id: string;
          project_id: string;
          resolved?: boolean;
          run_id?: string | null;
          severity?: Database["public"]["Enums"]["reconciliation_severity"];
        };
        Update: {
          actual?: number | null;
          check_key?: string;
          created_at?: string;
          expected?: number | null;
          id?: string;
          message?: string;
          owner_id?: string;
          project_id?: string;
          resolved?: boolean;
          run_id?: string | null;
          severity?: Database["public"]["Enums"]["reconciliation_severity"];
        };
        Relationships: [
          {
            foreignKeyName: "reconciliation_flags_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reconciliation_flags_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      relationship_contacts: {
        Row: {
          company: string | null;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          last_contacted_at: string | null;
          next_follow_up_at: string | null;
          notes: string | null;
          owner_id: string;
          phone: string | null;
          relationship_type: string;
          strength: string;
          title: string | null;
          updated_at: string;
          workspace_id: string | null;
        };
        Insert: {
          company?: string | null;
          created_at?: string;
          email?: string | null;
          full_name: string;
          id?: string;
          last_contacted_at?: string | null;
          next_follow_up_at?: string | null;
          notes?: string | null;
          owner_id: string;
          phone?: string | null;
          relationship_type?: string;
          strength?: string;
          title?: string | null;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Update: {
          company?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          last_contacted_at?: string | null;
          next_follow_up_at?: string | null;
          notes?: string | null;
          owner_id?: string;
          phone?: string | null;
          relationship_type?: string;
          strength?: string;
          title?: string | null;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "relationship_contacts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      revenue_program: {
        Row: {
          avg_sf: number | null;
          created_at: string;
          id: string;
          market_rent_monthly: number;
          occupancy_pct: number | null;
          owner_id: string;
          project_id: string;
          rent_basis: Database["public"]["Enums"]["rent_basis"];
          source: Database["public"]["Enums"]["assumption_source_kind"];
          source_document_id: string | null;
          source_text: string | null;
          status: Database["public"]["Enums"]["engine_input_status"];
          unit_count: number;
          unit_type: string;
          updated_at: string;
        };
        Insert: {
          avg_sf?: number | null;
          created_at?: string;
          id?: string;
          market_rent_monthly: number;
          occupancy_pct?: number | null;
          owner_id: string;
          project_id: string;
          rent_basis?: Database["public"]["Enums"]["rent_basis"];
          source?: Database["public"]["Enums"]["assumption_source_kind"];
          source_document_id?: string | null;
          source_text?: string | null;
          status?: Database["public"]["Enums"]["engine_input_status"];
          unit_count: number;
          unit_type: string;
          updated_at?: string;
        };
        Update: {
          avg_sf?: number | null;
          created_at?: string;
          id?: string;
          market_rent_monthly?: number;
          occupancy_pct?: number | null;
          owner_id?: string;
          project_id?: string;
          rent_basis?: Database["public"]["Enums"]["rent_basis"];
          source?: Database["public"]["Enums"]["assumption_source_kind"];
          source_document_id?: string | null;
          source_text?: string | null;
          status?: Database["public"]["Enums"]["engine_input_status"];
          unit_count?: number;
          unit_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "revenue_program_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "revenue_program_source_document_id_fkey";
            columns: ["source_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      risk_register: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          owner_id: string;
          project_id: string;
          related_assumption_id: string | null;
          risk_type: string;
          run_id: string | null;
          severity: Database["public"]["Enums"]["risk_severity"];
          title: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          owner_id: string;
          project_id: string;
          related_assumption_id?: string | null;
          risk_type: string;
          run_id?: string | null;
          severity?: Database["public"]["Enums"]["risk_severity"];
          title: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          owner_id?: string;
          project_id?: string;
          related_assumption_id?: string | null;
          risk_type?: string;
          run_id?: string | null;
          severity?: Database["public"]["Enums"]["risk_severity"];
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "risk_register_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "risk_register_related_assumption_id_fkey";
            columns: ["related_assumption_id"];
            isOneToOne: false;
            referencedRelation: "assumptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "risk_register_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      run_cash_flows: {
        Row: {
          amount: number;
          computed_at: string;
          id: string;
          line_key: Database["public"]["Enums"]["cash_flow_line_key"];
          owner_id: string;
          period_year: number;
          project_id: string;
          run_id: string;
          scenario_key: string;
        };
        Insert: {
          amount: number;
          computed_at?: string;
          id?: string;
          line_key: Database["public"]["Enums"]["cash_flow_line_key"];
          owner_id: string;
          period_year: number;
          project_id: string;
          run_id: string;
          scenario_key?: string;
        };
        Update: {
          amount?: number;
          computed_at?: string;
          id?: string;
          line_key?: Database["public"]["Enums"]["cash_flow_line_key"];
          owner_id?: string;
          period_year?: number;
          project_id?: string;
          run_id?: string;
          scenario_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "run_cash_flows_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "run_cash_flows_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      run_financial_outputs: {
        Row: {
          computed_at: string;
          formula_text: string | null;
          id: string;
          inputs: Json | null;
          metric_key: string;
          metric_label: string | null;
          owner_id: string;
          project_id: string;
          run_id: string;
          scenario_key: string;
          unit: string | null;
          value_numeric: number | null;
        };
        Insert: {
          computed_at?: string;
          formula_text?: string | null;
          id?: string;
          inputs?: Json | null;
          metric_key: string;
          metric_label?: string | null;
          owner_id: string;
          project_id: string;
          run_id: string;
          scenario_key?: string;
          unit?: string | null;
          value_numeric?: number | null;
        };
        Update: {
          computed_at?: string;
          formula_text?: string | null;
          id?: string;
          inputs?: Json | null;
          metric_key?: string;
          metric_label?: string | null;
          owner_id?: string;
          project_id?: string;
          run_id?: string;
          scenario_key?: string;
          unit?: string | null;
          value_numeric?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "run_financial_outputs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "run_financial_outputs_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      run_reconciliation_flags: {
        Row: {
          actual: number | null;
          check_key: string;
          created_at: string;
          expected: number | null;
          id: string;
          message: string;
          owner_id: string;
          project_id: string;
          resolved: boolean;
          run_id: string;
          severity: Database["public"]["Enums"]["reconciliation_severity"];
        };
        Insert: {
          actual?: number | null;
          check_key: string;
          created_at?: string;
          expected?: number | null;
          id?: string;
          message: string;
          owner_id: string;
          project_id: string;
          resolved?: boolean;
          run_id: string;
          severity?: Database["public"]["Enums"]["reconciliation_severity"];
        };
        Update: {
          actual?: number | null;
          check_key?: string;
          created_at?: string;
          expected?: number | null;
          id?: string;
          message?: string;
          owner_id?: string;
          project_id?: string;
          resolved?: boolean;
          run_id?: string;
          severity?: Database["public"]["Enums"]["reconciliation_severity"];
        };
        Relationships: [
          {
            foreignKeyName: "run_reconciliation_flags_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "run_reconciliation_flags_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      run_risk_register: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          owner_id: string;
          project_id: string;
          related_assumption_id: string | null;
          risk_type: string;
          run_id: string;
          severity: Database["public"]["Enums"]["risk_severity"];
          title: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          owner_id: string;
          project_id: string;
          related_assumption_id?: string | null;
          risk_type: string;
          run_id: string;
          severity?: Database["public"]["Enums"]["risk_severity"];
          title: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          owner_id?: string;
          project_id?: string;
          related_assumption_id?: string | null;
          risk_type?: string;
          run_id?: string;
          severity?: Database["public"]["Enums"]["risk_severity"];
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "run_risk_register_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "run_risk_register_related_assumption_id_fkey";
            columns: ["related_assumption_id"];
            isOneToOne: false;
            referencedRelation: "assumptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "run_risk_register_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "underwriting_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      scenarios: {
        Row: {
          cost_change: number | null;
          created_at: string;
          exit_cap_rate: number | null;
          exit_cap_rate_pct: number | null;
          id: string;
          interest_rate_change: number | null;
          name: string;
          occupancy: number | null;
          occupancy_pct: number | null;
          owner_id: string;
          project_id: string;
          rent_growth: number | null;
          rent_growth_pct: number | null;
          revenue_change: number | null;
        };
        Insert: {
          cost_change?: number | null;
          created_at?: string;
          exit_cap_rate?: number | null;
          exit_cap_rate_pct?: number | null;
          id?: string;
          interest_rate_change?: number | null;
          name: string;
          occupancy?: number | null;
          occupancy_pct?: number | null;
          owner_id: string;
          project_id: string;
          rent_growth?: number | null;
          rent_growth_pct?: number | null;
          revenue_change?: number | null;
        };
        Update: {
          cost_change?: number | null;
          created_at?: string;
          exit_cap_rate?: number | null;
          exit_cap_rate_pct?: number | null;
          id?: string;
          interest_rate_change?: number | null;
          name?: string;
          occupancy?: number | null;
          occupancy_pct?: number | null;
          owner_id?: string;
          project_id?: string;
          rent_growth?: number | null;
          rent_growth_pct?: number | null;
          revenue_change?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "scenarios_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      schema_migrations: {
        Row: {
          applied_at: string;
          version: string;
        };
        Insert: {
          applied_at?: string;
          version: string;
        };
        Update: {
          applied_at?: string;
          version?: string;
        };
        Relationships: [];
      };
      underwriting_inputs: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          conflict_values: Json | null;
          created_at: string;
          formula_text: string | null;
          id: string;
          key: string;
          owner_id: string;
          project_id: string;
          resolution_note: string | null;
          source: Database["public"]["Enums"]["assumption_source_kind"];
          source_document_id: string | null;
          source_text: string | null;
          status: Database["public"]["Enums"]["engine_input_status"];
          updated_at: string;
          value_numeric: number | null;
          value_text: string | null;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          conflict_values?: Json | null;
          created_at?: string;
          formula_text?: string | null;
          id?: string;
          key: string;
          owner_id: string;
          project_id: string;
          resolution_note?: string | null;
          source?: Database["public"]["Enums"]["assumption_source_kind"];
          source_document_id?: string | null;
          source_text?: string | null;
          status?: Database["public"]["Enums"]["engine_input_status"];
          updated_at?: string;
          value_numeric?: number | null;
          value_text?: string | null;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          conflict_values?: Json | null;
          created_at?: string;
          formula_text?: string | null;
          id?: string;
          key?: string;
          owner_id?: string;
          project_id?: string;
          resolution_note?: string | null;
          source?: Database["public"]["Enums"]["assumption_source_kind"];
          source_document_id?: string | null;
          source_text?: string | null;
          status?: Database["public"]["Enums"]["engine_input_status"];
          updated_at?: string;
          value_numeric?: number | null;
          value_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "underwriting_inputs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "underwriting_inputs_source_document_id_fkey";
            columns: ["source_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      underwriting_runs: {
        Row: {
          accepted_defaults_used: Json;
          blocked_reasons: Json;
          computed_at: string;
          conflict_resolutions_used: Json;
          created_at: string;
          created_by: string;
          id: string;
          input_fingerprint: string;
          input_snapshot: Json;
          output_fingerprint: string | null;
          output_snapshot: Json;
          owner_id: string;
          project_id: string;
          run_mode: string;
          run_number: number;
          status: string;
          verdict_code: string | null;
        };
        Insert: {
          accepted_defaults_used?: Json;
          blocked_reasons?: Json;
          computed_at?: string;
          conflict_resolutions_used?: Json;
          created_at?: string;
          created_by: string;
          id?: string;
          input_fingerprint: string;
          input_snapshot?: Json;
          output_fingerprint?: string | null;
          output_snapshot?: Json;
          owner_id: string;
          project_id: string;
          run_mode: string;
          run_number: number;
          status: string;
          verdict_code?: string | null;
        };
        Update: {
          accepted_defaults_used?: Json;
          blocked_reasons?: Json;
          computed_at?: string;
          conflict_resolutions_used?: Json;
          created_at?: string;
          created_by?: string;
          id?: string;
          input_fingerprint?: string;
          input_snapshot?: Json;
          output_fingerprint?: string | null;
          output_snapshot?: Json;
          owner_id?: string;
          project_id?: string;
          run_mode?: string;
          run_number?: number;
          status?: string;
          verdict_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "underwriting_runs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      user_preferences: {
        Row: {
          created_at: string;
          data: Json;
          onboarding_completed_at: string | null;
          onboarding_dismissed: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          data?: Json;
          onboarding_completed_at?: string | null;
          onboarding_dismissed?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          onboarding_completed_at?: string | null;
          onboarding_dismissed?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      webhook_endpoints: {
        Row: {
          active: boolean;
          created_at: string;
          endpoint_url: string;
          event_types: string[];
          id: string;
          last_delivery_at: string | null;
          last_delivery_status: string | null;
          name: string;
          owner_id: string;
          signing_secret_hint: string | null;
          updated_at: string;
          workspace_id: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          endpoint_url: string;
          event_types?: string[];
          id?: string;
          last_delivery_at?: string | null;
          last_delivery_status?: string | null;
          name: string;
          owner_id: string;
          signing_secret_hint?: string | null;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          endpoint_url?: string;
          event_types?: string[];
          id?: string;
          last_delivery_at?: string | null;
          last_delivery_status?: string | null;
          name?: string;
          owner_id?: string;
          signing_secret_hint?: string | null;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_invitations: {
        Row: {
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          role: Database["public"]["Enums"]["workspace_role"];
          status: string;
          token: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          status?: string;
          token?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          status?: string;
          token?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_settings: {
        Row: {
          allowed_email_domains: string[];
          approval_threshold: number | null;
          audit_log_retention_days: number;
          backup_rpo_hours: number;
          backup_rto_hours: number;
          created_at: string;
          data_residency_region: string | null;
          data_retention_days: number;
          dpa_status: string;
          incident_severity_policy: string;
          last_dr_test_at: string | null;
          last_pen_test_at: string | null;
          on_call_rotation_url: string | null;
          require_two_person_approval: boolean;
          scim_enabled: boolean;
          soc2_observation_started_at: string | null;
          sso_enforced: boolean;
          sso_metadata_url: string | null;
          sso_provider: string | null;
          status_page_url: string | null;
          tenant_encryption_mode: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          allowed_email_domains?: string[];
          approval_threshold?: number | null;
          audit_log_retention_days?: number;
          backup_rpo_hours?: number;
          backup_rto_hours?: number;
          created_at?: string;
          data_residency_region?: string | null;
          data_retention_days?: number;
          dpa_status?: string;
          incident_severity_policy?: string;
          last_dr_test_at?: string | null;
          last_pen_test_at?: string | null;
          on_call_rotation_url?: string | null;
          require_two_person_approval?: boolean;
          scim_enabled?: boolean;
          soc2_observation_started_at?: string | null;
          sso_enforced?: boolean;
          sso_metadata_url?: string | null;
          sso_provider?: string | null;
          status_page_url?: string | null;
          tenant_encryption_mode?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          allowed_email_domains?: string[];
          approval_threshold?: number | null;
          audit_log_retention_days?: number;
          backup_rpo_hours?: number;
          backup_rto_hours?: number;
          created_at?: string;
          data_residency_region?: string | null;
          data_retention_days?: number;
          dpa_status?: string;
          incident_severity_policy?: string;
          last_dr_test_at?: string | null;
          last_pen_test_at?: string | null;
          on_call_rotation_url?: string | null;
          require_two_person_approval?: boolean;
          scim_enabled?: boolean;
          soc2_observation_started_at?: string | null;
          sso_enforced?: boolean;
          sso_metadata_url?: string | null;
          sso_provider?: string | null;
          status_page_url?: string | null;
          tenant_encryption_mode?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      permit_rule_review_queue: {
        Row: {
          id: string | null;
          jurisdiction_id: string | null;
          jurisdiction_name: string | null;
          name: string | null;
          next_review_at: string | null;
          official_source_url: string | null;
          permit_type: string | null;
          review_state: string | null;
          rule_version: string | null;
          verification_status: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "permit_rules_jurisdiction_id_fkey";
            columns: ["jurisdiction_id"];
            isOneToOne: false;
            referencedRelation: "jurisdictions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      accept_workspace_invitation: {
        Args: { p_token: string };
        Returns: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "workspace_members";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      audit_log_canonical: {
        Args: {
          p_action: string;
          p_created_at: string;
          p_entity_id: string;
          p_entity_type: string;
          p_owner_id: string;
          p_payload: Json;
          p_project_id: string;
          p_seq: number;
          p_user_id: string;
        };
        Returns: string;
      };
      audit_log_row_hash: {
        Args: { p_canonical: string; p_prev_hash: string };
        Returns: string;
      };
      claim_document_upload_cleanup: {
        Args: { p_limit?: number };
        Returns: {
          object_path: string;
          upload_id: string;
        }[];
      };
      claim_next_extraction_job: {
        Args: { p_lease_seconds?: number; p_worker_id: string };
        Returns: {
          attempts: number;
          cancellation_requested: boolean;
          created_at: string;
          dead_lettered_at: string | null;
          document_id: string | null;
          error: string | null;
          finished_at: string | null;
          heartbeat_at: string | null;
          id: string;
          idempotency_key: string;
          kind: string;
          lease_expires_at: string | null;
          lease_owner: string | null;
          max_attempts: number;
          message: string | null;
          owner_id: string;
          pending_upload_id: string | null;
          priority: number;
          progress: number;
          project_id: string | null;
          result_json: Json | null;
          scheduled_at: string;
          started_at: string | null;
          status: string;
          total: number | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "extraction_jobs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      complete_document_verification: {
        Args: {
          p_actual_size_bytes: number;
          p_content_hash: string;
          p_job_id: string;
          p_scan_detail: string;
          p_verified_content_type: string;
          p_worker_id: string;
        };
        Returns: {
          deduped: boolean;
          document_id: string;
          extraction_job_id: string;
        }[];
      };
      consume_rate_limit: {
        Args: {
          p_bucket: string;
          p_cost: number;
          p_max_events: number;
          p_metadata?: Json;
          p_window_seconds: number;
          p_workspace_id?: string;
        };
        Returns: boolean;
      };
      create_workspace: {
        Args: { p_name: string };
        Returns: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "workspaces";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      delete_underwriting_outputs: {
        Args: { p_project_id: string };
        Returns: undefined;
      };
      enqueue_document_verification: {
        Args: { p_upload_id: string };
        Returns: {
          document_id: string;
          job_id: string;
          status: string;
        }[];
      };
      finalize_document_upload: {
        Args: {
          p_actual_size_bytes: number;
          p_content_hash: string;
          p_owner_id: string;
          p_scan_detail: string;
          p_upload_id: string;
          p_verified_content_type: string;
        };
        Returns: {
          deduped: boolean;
          document_id: string;
          object_path: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      heartbeat_extraction_job: {
        Args: {
          p_job_id: string;
          p_lease_seconds?: number;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      is_workspace_member: { Args: { ws: string }; Returns: boolean };
      permit_project_access: {
        Args: { p_project_id: string };
        Returns: boolean;
      };
      persist_underwriting_run_transaction: {
        Args: {
          p_accepted_defaults_used?: Json;
          p_audit_payload?: Json;
          p_blocked_reasons?: Json;
          p_cash_flows?: Json;
          p_conflict_resolutions_used?: Json;
          p_created_by: string;
          p_financial_outputs?: Json;
          p_input_fingerprint: string;
          p_input_snapshot?: Json;
          p_job_id?: string;
          p_job_result?: Json;
          p_output_fingerprint?: string;
          p_output_snapshot?: Json;
          p_owner_id: string;
          p_project_id: string;
          p_reconciliation_flags?: Json;
          p_risk_register?: Json;
          p_run_mode: string;
          p_status: string;
          p_verdict_code?: string;
        };
        Returns: {
          accepted_defaults_used: Json;
          blocked_reasons: Json;
          computed_at: string;
          conflict_resolutions_used: Json;
          created_at: string;
          created_by: string;
          id: string;
          input_fingerprint: string;
          input_snapshot: Json;
          output_fingerprint: string | null;
          output_snapshot: Json;
          owner_id: string;
          project_id: string;
          run_mode: string;
          run_number: number;
          status: string;
          verdict_code: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "underwriting_runs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      prepare_document_upload: {
        Args: {
          p_category?: string;
          p_expected_content_type: string;
          p_expected_size_bytes: number;
          p_file_name: string;
          p_project_id: string;
        };
        Returns: {
          expires_at: string;
          object_path: string;
          upload_id: string;
        }[];
      };
      reject_document_upload: {
        Args: { p_owner_id: string; p_reason: string; p_upload_id: string };
        Returns: boolean;
      };
      reject_document_verification: {
        Args: { p_job_id: string; p_reason: string; p_worker_id: string };
        Returns: boolean;
      };
      request_extraction_job_cancellation: {
        Args: { p_job_id: string };
        Returns: boolean;
      };
      verify_audit_chain: { Args: { p_project: string }; Returns: Json };
      workspace_role: { Args: { ws: string }; Returns: string };
    };
    Enums: {
      app_role: "admin" | "analyst" | "executive";
      assumption_source_kind: "extracted" | "analyst" | "default";
      assumption_status:
        | "pending"
        | "approved"
        | "modified"
        | "rejected"
        | "needs_review"
        | "missing"
        | "extracted"
        | "conflicting"
        | "default_accepted"
        | "calculated";
      cash_flow_line_key:
        | "equity"
        | "construction"
        | "interest"
        | "gross_revenue"
        | "egi"
        | "opex"
        | "noi"
        | "debt_service"
        | "levered_cf"
        | "sale_proceeds"
        | "loan_payoff";
      confidence_band: "high" | "medium" | "low" | "missing";
      deal_type: "development" | "acquisition";
      development_budget_category:
        | "land"
        | "hard"
        | "soft"
        | "contingency"
        | "financing_interest"
        | "other";
      engine_input_status:
        | "proposed"
        | "extracted"
        | "conflicting"
        | "approved"
        | "default_accepted"
        | "calculated"
        | "rejected";
      ic_decision: "approve" | "approve_with_conditions" | "reject" | "return_to_underwriting";
      project_status:
        | "pipeline"
        | "underwriting"
        | "approved"
        | "active"
        | "completed"
        | "cancelled";
      project_type:
        | "multifamily"
        | "commercial"
        | "mixed_use"
        | "land"
        | "industrial"
        | "retail"
        | "office"
        | "other"
        | "hospitality"
        | "self_storage"
        | "data_center"
        | "life_science";
      reconciliation_severity: "info" | "warning" | "error";
      rent_basis: "per_unit" | "per_sf";
      risk_severity: "info" | "yellow" | "red" | "critical";
      workspace_role: "owner" | "admin" | "member" | "viewer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "analyst", "executive"],
      assumption_source_kind: ["extracted", "analyst", "default"],
      assumption_status: [
        "pending",
        "approved",
        "modified",
        "rejected",
        "needs_review",
        "missing",
        "extracted",
        "conflicting",
        "default_accepted",
        "calculated",
      ],
      cash_flow_line_key: [
        "equity",
        "construction",
        "interest",
        "gross_revenue",
        "egi",
        "opex",
        "noi",
        "debt_service",
        "levered_cf",
        "sale_proceeds",
        "loan_payoff",
      ],
      confidence_band: ["high", "medium", "low", "missing"],
      deal_type: ["development", "acquisition"],
      development_budget_category: [
        "land",
        "hard",
        "soft",
        "contingency",
        "financing_interest",
        "other",
      ],
      engine_input_status: [
        "proposed",
        "extracted",
        "conflicting",
        "approved",
        "default_accepted",
        "calculated",
        "rejected",
      ],
      ic_decision: ["approve", "approve_with_conditions", "reject", "return_to_underwriting"],
      project_status: ["pipeline", "underwriting", "approved", "active", "completed", "cancelled"],
      project_type: [
        "multifamily",
        "commercial",
        "mixed_use",
        "land",
        "industrial",
        "retail",
        "office",
        "other",
        "hospitality",
        "self_storage",
        "data_center",
        "life_science",
      ],
      reconciliation_severity: ["info", "warning", "error"],
      rent_basis: ["per_unit", "per_sf"],
      risk_severity: ["info", "yellow", "red", "critical"],
      workspace_role: ["owner", "admin", "member", "viewer"],
    },
  },
} as const;
