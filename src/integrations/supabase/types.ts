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
    PostgrestVersion: "14.5"
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
      apps: {
        Row: {
          bundle_id: string | null
          created_at: string
          default_ref: string
          github_owner: string
          github_repo: string
          icon_data_url: string | null
          id: string
          is_active: boolean
          marketing_version: string | null
          name: string
          notes: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          bundle_id?: string | null
          created_at?: string
          default_ref?: string
          github_owner: string
          github_repo: string
          icon_data_url?: string | null
          id?: string
          is_active?: boolean
          marketing_version?: string | null
          name: string
          notes?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          bundle_id?: string | null
          created_at?: string
          default_ref?: string
          github_owner?: string
          github_repo?: string
          icon_data_url?: string | null
          id?: string
          is_active?: boolean
          marketing_version?: string | null
          name?: string
          notes?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_events: {
        Row: {
          created_at: string
          event_date: string
          event_type: string
          id: string
          platform: Database["public"]["Enums"]["purchase_platform"]
          purchase_id: string
          raw_data: Json
        }
        Insert: {
          created_at?: string
          event_date: string
          event_type: string
          id?: string
          platform: Database["public"]["Enums"]["purchase_platform"]
          purchase_id: string
          raw_data?: Json
        }
        Update: {
          created_at?: string
          event_date?: string
          event_type?: string
          id?: string
          platform?: Database["public"]["Enums"]["purchase_platform"]
          purchase_id?: string
          raw_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "purchase_events_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          app_id: string
          created_at: string
          environment: Database["public"]["Enums"]["purchase_environment"]
          id: string
          local_amount: number | null
          local_currency: string | null
          platform: Database["public"]["Enums"]["purchase_platform"]
          product_id: string
          product_type: Database["public"]["Enums"]["purchase_product_type"]
          purchase_date: string
          raw_payload: Json
          revenue_usd: number
          status: Database["public"]["Enums"]["purchase_status"]
          subscription_expires_at: string | null
          transaction_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          app_id: string
          created_at?: string
          environment?: Database["public"]["Enums"]["purchase_environment"]
          id?: string
          local_amount?: number | null
          local_currency?: string | null
          platform: Database["public"]["Enums"]["purchase_platform"]
          product_id: string
          product_type: Database["public"]["Enums"]["purchase_product_type"]
          purchase_date: string
          raw_payload?: Json
          revenue_usd?: number
          status?: Database["public"]["Enums"]["purchase_status"]
          subscription_expires_at?: string | null
          transaction_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          app_id?: string
          created_at?: string
          environment?: Database["public"]["Enums"]["purchase_environment"]
          id?: string
          local_amount?: number | null
          local_currency?: string | null
          platform?: Database["public"]["Enums"]["purchase_platform"]
          product_id?: string
          product_type?: Database["public"]["Enums"]["purchase_product_type"]
          purchase_date?: string
          raw_payload?: Json
          revenue_usd?: number
          status?: Database["public"]["Enums"]["purchase_status"]
          subscription_expires_at?: string | null
          transaction_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      revenue_by_app: {
        Args: {
          p_from?: string
          p_platform?: Database["public"]["Enums"]["purchase_platform"]
          p_to?: string
        }
        Returns: {
          app_id: string
          app_name: string
          revenue_usd: number
        }[]
      }
      revenue_by_platform: {
        Args: { p_app?: string; p_from?: string; p_to?: string }
        Returns: {
          platform: Database["public"]["Enums"]["purchase_platform"]
          revenue_usd: number
        }[]
      }
      revenue_stats: {
        Args: {
          p_app?: string
          p_from?: string
          p_platform?: Database["public"]["Enums"]["purchase_platform"]
          p_to?: string
        }
        Returns: {
          active_subs: number
          month_usd: number
          mrr_usd: number
          prev_month_usd: number
          total_usd: number
        }[]
      }
      revenue_timeseries: {
        Args: {
          p_app?: string
          p_from?: string
          p_platform?: Database["public"]["Enums"]["purchase_platform"]
          p_to?: string
        }
        Returns: {
          day: string
          revenue_usd: number
        }[]
      }
      top_products: {
        Args: {
          p_app?: string
          p_from?: string
          p_limit?: number
          p_platform?: Database["public"]["Enums"]["purchase_platform"]
          p_to?: string
        }
        Returns: {
          count: number
          product_id: string
          revenue_usd: number
        }[]
      }
    }
    Enums: {
      purchase_environment: "production" | "sandbox"
      purchase_platform: "ios" | "android"
      purchase_product_type:
        | "consumable"
        | "non_consumable"
        | "subscription"
        | "auto_renewable_subscription"
      purchase_status: "active" | "cancelled" | "refunded" | "expired"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      purchase_environment: ["production", "sandbox"],
      purchase_platform: ["ios", "android"],
      purchase_product_type: [
        "consumable",
        "non_consumable",
        "subscription",
        "auto_renewable_subscription",
      ],
      purchase_status: ["active", "cancelled", "refunded", "expired"],
    },
  },
} as const
