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
