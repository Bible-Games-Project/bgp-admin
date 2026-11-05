export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_attachments: {
        Row: {
          app_id: string
          content_type: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          size: number
          storage_path: string
          thumbnail: string | null
          turn_id: string | null
        }
        Insert: {
          app_id: string
          content_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          size: number
          storage_path: string
          thumbnail?: string | null
          turn_id?: string | null
        }
        Update: {
          app_id?: string
          content_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          size?: number
          storage_path?: string
          thumbnail?: string | null
          turn_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_attachments_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_attachments_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "agent_turns"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_chats: {
        Row: {
          app_id: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          session_id: string | null
          kind: string
          user_id: string | null
        }
        Insert: {
          app_id?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          session_id?: string | null
          kind?: string
          user_id?: string | null
        }
        Update: {
          app_id?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          session_id?: string | null
          kind?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_chats_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_environment_changes: {
        Row: {
          add_domains: string[]
          created_at: string
          created_by: string | null
          created_by_email: string | null
          domains: string[] | null
          error: string | null
          id: string
          remove_domains: string[]
          remove_variables: string[]
          set_variables: Json | null
          skipped: string[]
          status: string
          updated_at: string
        }
        Insert: {
          add_domains?: string[]
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          domains?: string[] | null
          error?: string | null
          id?: string
          remove_domains?: string[]
          remove_variables?: string[]
          set_variables?: Json | null
          skipped?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          add_domains?: string[]
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          domains?: string[] | null
          error?: string | null
          id?: string
          remove_domains?: string[]
          remove_variables?: string[]
          set_variables?: Json | null
          skipped?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_events: {
        Row: {
          app_id: string | null
          body: Json
          created_at: string
          id: number
          kind: string
          turn_id: string
        }
        Insert: {
          app_id: string | null
          body: Json
          created_at?: string
          id?: number
          kind: string
          turn_id: string
        }
        Update: {
          app_id?: string | null
          body?: Json
          created_at?: string
          id?: number
          kind?: string
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "agent_turns"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_logins: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          error: string | null
          id: string
          mode: string
          status: string
          token: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          error?: string | null
          id?: string
          mode?: string
          status?: string
          token?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          error?: string | null
          id?: string
          mode?: string
          status?: string
          token?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      agent_repo_keys: {
        Row: {
          github_key_id: number | null
          public_key: string
          registered_at: string
          repo: string
        }
        Insert: {
          github_key_id?: number | null
          public_key: string
          registered_at?: string
          repo: string
        }
        Update: {
          github_key_id?: number | null
          public_key?: string
          registered_at?: string
          repo?: string
        }
        Relationships: []
      }
      agent_runner: {
        Row: {
          account: Json | null
          busy: boolean
          environment: Json | null
          host: string | null
          id: string
          last_seen_at: string | null
          unlink_requested_at: string | null
          usage: Json | null
          usage_requested_at: string | null
          version: string | null
          watched_until: string | null
        }
        Insert: {
          account?: Json | null
          busy?: boolean
          environment?: Json | null
          host?: string | null
          id?: string
          last_seen_at?: string | null
          unlink_requested_at?: string | null
          usage?: Json | null
          usage_requested_at?: string | null
          version?: string | null
          watched_until?: string | null
        }
        Update: {
          account?: Json | null
          busy?: boolean
          environment?: Json | null
          host?: string | null
          id?: string
          last_seen_at?: string | null
          unlink_requested_at?: string | null
          usage?: Json | null
          usage_requested_at?: string | null
          version?: string | null
          watched_until?: string | null
        }
        Relationships: []
      }
      agent_turns: {
        Row: {
          app_id: string | null
          cancel_requested_at: string | null
          chat_id: string
          commits: number
          created_at: string
          created_by: string | null
          created_by_email: string | null
          error: string | null
          finished_at: string | null
          id: string
          prompt: string
          pushed_sha: string | null
          reply: string | null
          started_at: string | null
          status: string
          usage: Json | null
          weekly_resets_at: string | null
          weekly_spent: number | null
          context: Json | null
          tool_token: string | null
        }
        Insert: {
          app_id: string | null
          cancel_requested_at?: string | null
          chat_id: string
          commits?: number
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          prompt: string
          pushed_sha?: string | null
          reply?: string | null
          started_at?: string | null
          status?: string
          usage?: Json | null
          weekly_resets_at?: string | null
          weekly_spent?: number | null
          context?: Json | null
          tool_token?: string | null
        }
        Update: {
          app_id?: string | null
          cancel_requested_at?: string | null
          chat_id?: string
          commits?: number
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          prompt?: string
          pushed_sha?: string | null
          reply?: string | null
          started_at?: string | null
          status?: string
          usage?: Json | null
          weekly_resets_at?: string | null
          weekly_spent?: number | null
          context?: Json | null
          tool_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_turns_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_turns_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "agent_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      app_setup_steps: {
        Row: {
          app_id: string
          completed_at: string
          completed_by: string | null
          step_key: string
        }
        Insert: {
          app_id: string
          completed_at?: string
          completed_by?: string | null
          step_key: string
        }
        Update: {
          app_id?: string
          completed_at?: string
          completed_by?: string | null
          step_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_setup_steps_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      apps: {
        Row: {
          android_package_name: string | null
          bundle_id: string | null
          created_at: string
          default_ref: string
          full_game_id: string | null
          github_owner: string | null
          github_repo: string | null
          icon_data_url: string | null
          id: string
          is_active: boolean
          marketing_version: string | null
          name: string
          notes: string | null
          slug: string
          steam_app_id: number | null
          updated_at: string
        }
        Insert: {
          android_package_name?: string | null
          bundle_id?: string | null
          created_at?: string
          default_ref?: string
          full_game_id?: string | null
          github_owner?: string | null
          github_repo?: string | null
          icon_data_url?: string | null
          id?: string
          is_active?: boolean
          marketing_version?: string | null
          name: string
          notes?: string | null
          slug: string
          steam_app_id?: number | null
          updated_at?: string
        }
        Update: {
          android_package_name?: string | null
          bundle_id?: string | null
          created_at?: string
          default_ref?: string
          full_game_id?: string | null
          github_owner?: string | null
          github_repo?: string | null
          icon_data_url?: string | null
          id?: string
          is_active?: boolean
          marketing_version?: string | null
          name?: string
          notes?: string | null
          slug?: string
          steam_app_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "apps_full_game_id_fkey"
            columns: ["full_game_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      download_reports: {
        Row: {
          fetched_at: string
          period: string
          report: string
          rows: Json
          source: string
          version: string | null
        }
        Insert: {
          fetched_at?: string
          period: string
          report: string
          rows?: Json
          source: string
          version?: string | null
        }
        Update: {
          fetched_at?: string
          period?: string
          report?: string
          rows?: Json
          source?: string
          version?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          app_id: string | null
          created_at: string
          currency: string
          ends_on: string | null
          frequency: string
          id: string
          name: string
          notes: string | null
          starts_on: string
          updated_at: string
        }
        Insert: {
          amount: number
          app_id?: string | null
          created_at?: string
          currency?: string
          ends_on?: string | null
          frequency: string
          id?: string
          name: string
          notes?: string | null
          starts_on: string
          updated_at?: string
        }
        Update: {
          amount?: number
          app_id?: string | null
          created_at?: string
          currency?: string
          ends_on?: string | null
          frequency?: string
          id?: string
          name?: string
          notes?: string | null
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      income_reports: {
        Row: {
          fetched_at: string
          period: string
          report: string
          rows: Json
          source: string
          unconverted: string[]
          version: string | null
        }
        Insert: {
          fetched_at?: string
          period: string
          report: string
          rows?: Json
          source: string
          unconverted?: string[]
          version?: string | null
        }
        Update: {
          fetched_at?: string
          period?: string
          report?: string
          rows?: Json
          source?: string
          unconverted?: string[]
          version?: string | null
        }
        Relationships: []
      }
      income_sync: {
        Row: {
          checked_at: string
          problem: string | null
          source: string
        }
        Insert: {
          checked_at: string
          problem?: string | null
          source: string
        }
        Update: {
          checked_at?: string
          problem?: string | null
          source?: string
        }
        Relationships: []
      }
      monitor_checks: {
        Row: {
          key: string
          problem: string | null
          ran_at: string
          state: Json
        }
        Insert: {
          key: string
          problem?: string | null
          ran_at: string
          state?: Json
        }
        Update: {
          key?: string
          problem?: string | null
          ran_at?: string
          state?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
