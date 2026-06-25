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
          field_key: string;
          field_label: string;
          formula_text: string | null;
          id: string;
          impact_amount: number | null;
          impact_rank: number | null;
          owner_id: string;
          project_id: string;
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
          field_key: string;
          field_label: string;
          formula_text?: string | null;
          id?: string;
          impact_amount?: number | null;
          impact_rank?: number | null;
          owner_id: string;
          project_id: string;
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
          field_key?: string;
          field_label?: string;
          formula_text?: string | null;
          id?: string;
          impact_amount?: number | null;
          impact_rank?: number | null;
          owner_id?: string;
          project_id?: string;
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
      audit_logs: {
        Row: {
          action: string;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          owner_id: string;
          payload: Json | null;
          project_id: string | null;
          user_id: string;
          user_name: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          owner_id: string;
          payload?: Json | null;
          project_id?: string | null;
          user_id: string;
          user_name?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          owner_id?: string;
          payload?: Json | null;
          project_id?: string | null;
          user_id?: string;
          user_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
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
          extraction_error: string | null;
          file_type: string | null;
          id: string;
          name: string;
          owner_id: string;
          project_id: string | null;
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
          extraction_error?: string | null;
          file_type?: string | null;
          id?: string;
          name: string;
          owner_id: string;
          project_id?: string | null;
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
          extraction_error?: string | null;
          file_type?: string | null;
          id?: string;
          name?: string;
          owner_id?: string;
          project_id?: string | null;
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
        ];
      };
      generated_reports: {
        Row: {
          content_json: Json;
          created_at: string;
          generated_at: string;
          id: string;
          owner_id: string;
          project_id: string;
          report_type: string;
          status: string;
          title: string | null;
          verification_report: Json | null;
        };
        Insert: {
          content_json: Json;
          created_at?: string;
          generated_at?: string;
          id?: string;
          owner_id: string;
          project_id: string;
          report_type: string;
          status?: string;
          title?: string | null;
          verification_report?: Json | null;
        };
        Update: {
          content_json?: Json;
          created_at?: string;
          generated_at?: string;
          id?: string;
          owner_id?: string;
          project_id?: string;
          report_type?: string;
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
          status: string | null;
          verification_report: Json | null;
        };
        Insert: {
          content: Json;
          created_at?: string;
          id?: string;
          owner_id: string;
          project_id: string;
          status?: string | null;
          verification_report?: Json | null;
        };
        Update: {
          content?: Json;
          created_at?: string;
          id?: string;
          owner_id?: string;
          project_id?: string;
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
        ];
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
          name: string;
          notes: string | null;
          owner_id: string;
          probability: number;
          revenue_forecast: number | null;
          source: string | null;
          start_date: string | null;
          status: Database["public"]["Enums"]["project_status"];
          target_close_date: string | null;
          type: Database["public"]["Enums"]["project_type"];
          updated_at: string;
          workspace_id: string | null;
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
          name: string;
          notes?: string | null;
          owner_id: string;
          probability?: number;
          revenue_forecast?: number | null;
          source?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          target_close_date?: string | null;
          type?: Database["public"]["Enums"]["project_type"];
          updated_at?: string;
          workspace_id?: string | null;
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
          name?: string;
          notes?: string | null;
          owner_id?: string;
          probability?: number;
          revenue_forecast?: number | null;
          source?: string | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["project_status"];
          target_close_date?: string | null;
          type?: Database["public"]["Enums"]["project_type"];
          updated_at?: string;
          workspace_id?: string | null;
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
          created_at: string;
          data_retention_days: number;
          require_two_person_approval: boolean;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          allowed_email_domains?: string[];
          approval_threshold?: number | null;
          created_at?: string;
          data_retention_days?: number;
          require_two_person_approval?: boolean;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          allowed_email_domains?: string[];
          approval_threshold?: number | null;
          created_at?: string;
          data_retention_days?: number;
          require_two_person_approval?: boolean;
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
      [_ in never]: never;
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_workspace_member: { Args: { ws: string }; Returns: boolean };
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
