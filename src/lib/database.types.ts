
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "avatar_uploads": {
                  Row: {
                    "created_at": string,"declared_size_bytes": number,"id": string,"processed_at": string | null,"status": string,"storage_key": string,"user_id": string,"avatar_reservation_open": boolean | null
                  }
                  ComputedFields: "avatar_reservation_open"
                  Insert: {
                    "created_at"?: string,"declared_size_bytes": number,"id"?: string,"processed_at"?: string | null,"status"?: string,"storage_key": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"declared_size_bytes"?: number,"id"?: string,"processed_at"?: string | null,"status"?: string,"storage_key"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "avatar_uploads_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "description": string,"id": string,"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string,"id": string,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "description"?: string,"id"?: string,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"comments": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"edited_at": string | null,"id": string,"parent_id": string | null,"template_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body": string,"created_at"?: string,"edited_at"?: string | null,"id"?: string,"parent_id"?: string | null,"template_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"edited_at"?: string | null,"id"?: string,"parent_id"?: string | null,"template_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    }
                  ]
                },"download_events": {
                  Row: {
                    "actor_hash": string,"counted": boolean,"created_at": string,"file_id": string,"id": number,"template_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_hash": string,"counted": boolean,"created_at"?: string,"file_id": string,"id"?: never,"template_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "actor_hash"?: string,"counted"?: boolean,"created_at"?: string,"file_id"?: string,"id"?: never,"template_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "download_events_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "template_files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "download_events_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "download_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"favorites": {
                  Row: {
                    "created_at": string,"template_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"template_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"template_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "favorites_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "favorites_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"follows": {
                  Row: {
                    "created_at": string,"creator_id": string,"follower_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"creator_id": string,"follower_id": string
                  }
                  Update: {
                    "created_at"?: string,"creator_id"?: string,"follower_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "follows_creator_id_fkey"
      columns: ["creator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follows_follower_id_fkey"
      columns: ["follower_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"moderation_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"details": NonNullable<Json>,"file_id": string | null,"id": number,"target_user_id": string | null,"template_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"file_id"?: string | null,"id"?: never,"target_user_id"?: string | null,"template_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"file_id"?: string | null,"id"?: never,"target_user_id"?: string | null,"template_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"platforms": {
                  Row: {
                    "description": string,"id": string,"install_hint": string,"is_active": boolean,"name": string,"sort_order": number,"upload_formats": (string)[],"website": string,"zip_formats": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string,"id": string,"install_hint"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number,"upload_formats"?: (string)[],"website"?: string,"zip_formats"?: (string)[]
                  }
                  Update: {
                    "description"?: string,"id"?: string,"install_hint"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number,"upload_formats"?: (string)[],"website"?: string,"zip_formats"?: (string)[]
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "avatar_key": string | null,"bio": string,"created_at": string,"display_name": string,"follower_count": number,"id": string,"is_banned": boolean,"is_demo": boolean,"is_scanner": boolean,"role": Database["public"]['Enums']["app_role"],"updated_at": string,"username": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_key"?: string | null,"bio"?: string,"created_at"?: string,"display_name"?: string,"follower_count"?: number,"id": string,"is_banned"?: boolean,"is_demo"?: boolean,"is_scanner"?: boolean,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string,"username": string
                  }
                  Update: {
                    "avatar_key"?: string | null,"bio"?: string,"created_at"?: string,"display_name"?: string,"follower_count"?: number,"id"?: string,"is_banned"?: boolean,"is_demo"?: boolean,"is_scanner"?: boolean,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string,"username"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "bucket_key": string,"hits": number,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket_key": string,"hits": number,"window_start": string
                  }
                  Update: {
                    "bucket_key"?: string,"hits"?: number,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"reports": {
                  Row: {
                    "claimant_name": string | null,"comment_id": string | null,"contact_email": string | null,"created_at": string,"details": string,"good_faith_statement": boolean,"id": string,"kind": Database["public"]['Enums']["report_kind"],"original_work_url": string | null,"reporter_id": string | null,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"status": Database["public"]['Enums']["report_status"],"template_id": string | null,"template_slug": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "claimant_name"?: string | null,"comment_id"?: string | null,"contact_email"?: string | null,"created_at"?: string,"details": string,"good_faith_statement"?: boolean,"id"?: string,"kind": Database["public"]['Enums']["report_kind"],"original_work_url"?: string | null,"reporter_id"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"template_id"?: string | null,"template_slug"?: string | null
                  }
                  Update: {
                    "claimant_name"?: string | null,"comment_id"?: string | null,"contact_email"?: string | null,"created_at"?: string,"details"?: string,"good_faith_statement"?: boolean,"id"?: string,"kind"?: Database["public"]['Enums']["report_kind"],"original_work_url"?: string | null,"reporter_id"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"template_id"?: string | null,"template_slug"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"id": string,"is_hidden": boolean,"rating": number,"template_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body"?: string,"created_at"?: string,"id"?: string,"is_hidden"?: boolean,"rating": number,"template_id": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"is_hidden"?: boolean,"rating"?: number,"template_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    }
                  ]
                },"scan_records": {
                  Row: {
                    "created_at": string,"expected_sha256": string | null,"file_id": string,"hash_match": boolean,"id": string,"notes": string,"raw_output": string,"recorded_by": string | null,"result": Database["public"]['Enums']["scan_status"],"scanned_at": string,"scanned_sha256": string,"scanner_name": string,"scanner_version": string,"signature_version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expected_sha256"?: string | null,"file_id": string,"hash_match": boolean,"id"?: string,"notes"?: string,"raw_output"?: string,"recorded_by"?: string | null,"result": Database["public"]['Enums']["scan_status"],"scanned_at": string,"scanned_sha256": string,"scanner_name": string,"scanner_version": string,"signature_version": string
                  }
                  Update: {
                    "created_at"?: string,"expected_sha256"?: string | null,"file_id"?: string,"hash_match"?: boolean,"id"?: string,"notes"?: string,"raw_output"?: string,"recorded_by"?: string | null,"result"?: Database["public"]['Enums']["scan_status"],"scanned_at"?: string,"scanned_sha256"?: string,"scanner_name"?: string,"scanner_version"?: string,"signature_version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_records_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "template_files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scan_records_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"site_settings": {
                  Row: {
                    "auto_publish": boolean,"id": number,"max_daily_submissions": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auto_publish"?: boolean,"id"?: number,"max_daily_submissions"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "auto_publish"?: boolean,"id"?: number,"max_daily_submissions"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"template_files": {
                  Row: {
                    "approved_sha256": string | null,"contains_code": boolean,"created_at": string,"declared_size_bytes": number,"detected_format": string | null,"duplicate_of": string | null,"extension": string,"id": string,"is_current": boolean,"needs_review": boolean,"original_filename": string,"processed_at": string | null,"replaces_file_id": string | null,"scan_status": Database["public"]['Enums']["scan_status"],"scanned_at": string | null,"scanned_sha256": string | null,"scanner_name": string | null,"scanner_version": string | null,"sha256": string | null,"signature_version": string | null,"size_bytes": number | null,"storage_bucket": string,"storage_key": string,"superseded_at": string | null,"template_id": string,"updated_at": string,"uploaded_at": string | null,"uploader_id": string,"validation_report": NonNullable<Json>,"validation_status": Database["public"]['Enums']["validation_status"],"file_bytes_expr": number | null
                  }
                  ComputedFields: "file_bytes_expr"
                  Insert: {
                    "approved_sha256"?: string | null,"contains_code"?: boolean,"created_at"?: string,"declared_size_bytes": number,"detected_format"?: string | null,"duplicate_of"?: string | null,"extension": string,"id"?: string,"is_current"?: boolean,"needs_review"?: boolean,"original_filename": string,"processed_at"?: string | null,"replaces_file_id"?: string | null,"scan_status"?: Database["public"]['Enums']["scan_status"],"scanned_at"?: string | null,"scanned_sha256"?: string | null,"scanner_name"?: string | null,"scanner_version"?: string | null,"sha256"?: string | null,"signature_version"?: string | null,"size_bytes"?: number | null,"storage_bucket"?: string,"storage_key": string,"superseded_at"?: string | null,"template_id": string,"updated_at"?: string,"uploaded_at"?: string | null,"uploader_id": string,"validation_report"?: NonNullable<Json>,"validation_status"?: Database["public"]['Enums']["validation_status"]
                  }
                  Update: {
                    "approved_sha256"?: string | null,"contains_code"?: boolean,"created_at"?: string,"declared_size_bytes"?: number,"detected_format"?: string | null,"duplicate_of"?: string | null,"extension"?: string,"id"?: string,"is_current"?: boolean,"needs_review"?: boolean,"original_filename"?: string,"processed_at"?: string | null,"replaces_file_id"?: string | null,"scan_status"?: Database["public"]['Enums']["scan_status"],"scanned_at"?: string | null,"scanned_sha256"?: string | null,"scanner_name"?: string | null,"scanner_version"?: string | null,"sha256"?: string | null,"signature_version"?: string | null,"size_bytes"?: number | null,"storage_bucket"?: string,"storage_key"?: string,"superseded_at"?: string | null,"template_id"?: string,"updated_at"?: string,"uploaded_at"?: string | null,"uploader_id"?: string,"validation_report"?: NonNullable<Json>,"validation_status"?: Database["public"]['Enums']["validation_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "template_files_duplicate_of_fkey"
      columns: ["duplicate_of"]
isOneToOne: false
      referencedRelation: "template_files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "template_files_replaces_file_id_fkey"
      columns: ["replaces_file_id"]
isOneToOne: false
      referencedRelation: "template_files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "template_files_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "template_files_uploader_id_fkey"
      columns: ["uploader_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"template_screenshots": {
                  Row: {
                    "caption": string,"created_at": string,"declared_size_bytes": number,"failure_reason": string | null,"height": number | null,"id": string,"original_bucket": string,"original_key": string,"position": number,"public_key": string | null,"public_size_bytes": number | null,"size_bytes": number | null,"status": Database["public"]['Enums']["screenshot_status"],"template_id": string,"thumb_key": string | null,"updated_at": string,"uploader_id": string,"width": number | null,"shot_bytes_expr": number | null
                  }
                  ComputedFields: "shot_bytes_expr"
                  Insert: {
                    "caption"?: string,"created_at"?: string,"declared_size_bytes": number,"failure_reason"?: string | null,"height"?: number | null,"id"?: string,"original_bucket"?: string,"original_key": string,"position"?: number,"public_key"?: string | null,"public_size_bytes"?: number | null,"size_bytes"?: number | null,"status"?: Database["public"]['Enums']["screenshot_status"],"template_id": string,"thumb_key"?: string | null,"updated_at"?: string,"uploader_id": string,"width"?: number | null
                  }
                  Update: {
                    "caption"?: string,"created_at"?: string,"declared_size_bytes"?: number,"failure_reason"?: string | null,"height"?: number | null,"id"?: string,"original_bucket"?: string,"original_key"?: string,"position"?: number,"public_key"?: string | null,"public_size_bytes"?: number | null,"size_bytes"?: number | null,"status"?: Database["public"]['Enums']["screenshot_status"],"template_id"?: string,"thumb_key"?: string | null,"updated_at"?: string,"uploader_id"?: string,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "template_screenshots_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "template_screenshots_uploader_id_fkey"
      columns: ["uploader_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"template_views": {
                  Row: {
                    "actor_hash": string,"template_id": string,"view_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_hash": string,"template_id": string,"view_date"?: string
                  }
                  Update: {
                    "actor_hash"?: string,"template_id"?: string,"view_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "template_views_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    }
                  ]
                },"templates": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"category_id": string,"comment_count": number,"cover_screenshot_id": string | null,"created_at": string,"creator_id": string,"dependencies": string,"description": string,"download_count": number,"favorite_count": number,"id": string,"install_steps": string,"is_demo": boolean,"license_code": string,"license_text": string,"moderation_note": string | null,"platform_id": string,"platform_version": string,"publication_status": Database["public"]['Enums']["publication_status"],"rating_avg": number,"rating_count": number,"requires_review": boolean,"rights_attested": boolean,"search_vector": unknown,"slug": string,"submitted_at": string | null,"summary": string,"tags": (string)[],"title": string,"updated_at": string,"view_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"category_id": string,"comment_count"?: number,"cover_screenshot_id"?: string | null,"created_at"?: string,"creator_id": string,"dependencies"?: string,"description"?: string,"download_count"?: number,"favorite_count"?: number,"id"?: string,"install_steps"?: string,"is_demo"?: boolean,"license_code"?: string,"license_text"?: string,"moderation_note"?: string | null,"platform_id": string,"platform_version"?: string,"publication_status"?: Database["public"]['Enums']["publication_status"],"rating_avg"?: number,"rating_count"?: number,"requires_review"?: boolean,"rights_attested"?: boolean,"search_vector"?: unknown,"slug": string,"submitted_at"?: string | null,"summary"?: string,"tags"?: (string)[],"title": string,"updated_at"?: string,"view_count"?: number
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"category_id"?: string,"comment_count"?: number,"cover_screenshot_id"?: string | null,"created_at"?: string,"creator_id"?: string,"dependencies"?: string,"description"?: string,"download_count"?: number,"favorite_count"?: number,"id"?: string,"install_steps"?: string,"is_demo"?: boolean,"license_code"?: string,"license_text"?: string,"moderation_note"?: string | null,"platform_id"?: string,"platform_version"?: string,"publication_status"?: Database["public"]['Enums']["publication_status"],"rating_avg"?: number,"rating_count"?: number,"requires_review"?: boolean,"rights_attested"?: boolean,"search_vector"?: unknown,"slug"?: string,"submitted_at"?: string | null,"summary"?: string,"tags"?: (string)[],"title"?: string,"updated_at"?: string,"view_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "templates_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "templates_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "templates_cover_fk"
      columns: ["cover_screenshot_id"]
isOneToOne: false
      referencedRelation: "template_screenshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "templates_creator_id_fkey"
      columns: ["creator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "templates_platform_id_fkey"
      columns: ["platform_id"]
isOneToOne: false
      referencedRelation: "platforms"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_delete_category":
{ Args: { "p_id": string }; Returns: undefined
                           },
"admin_save_category":
{ Args: { "p_description": string,"p_id": string,"p_name": string,"p_sort_order": number }; Returns: undefined
                           },
"admin_save_platform":
{ Args: { "p_description": string,"p_id": string,"p_install_hint": string,"p_is_active": boolean,"p_name": string,"p_sort_order": number,"p_upload_formats": (string)[],"p_website": string,"p_zip_formats": (string)[] }; Returns: undefined
                           },
"admin_set_auto_publish":
{ Args: { "p_enabled": boolean }; Returns: boolean
                           },
"admin_set_banned":
{ Args: { "p_banned": boolean,"p_reason"?: string,"p_user_id": string }; Returns: undefined
                           },
"admin_set_user_role":
{ Args: { "p_role": Database["public"]['Enums']["app_role"],"p_user_id": string }; Returns: undefined
                           },
"avatar_reservation_open":
{ Args: { "a": Omit<Database["public"]['Tables']["avatar_uploads"]['Row'], Database["public"]['Tables']["avatar_uploads"]['ComputedFields']> }; Returns: boolean
                           },
"cleanup_stale_uploads":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatars": number,"files": number,"screenshots": number
            }[]
                           },
"consume_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"file_bytes_expr":
{ Args: { "f": Omit<Database["public"]['Tables']["template_files"]['Row'], Database["public"]['Tables']["template_files"]['ComputedFields']> }; Returns: number
                           },
"file_download_state":
{ Args: { "p_file_id": string }; Returns: string
                           },
"file_duplicate_info":
{ Args: { "p_file_id": string }; Returns: {
              "is_public": boolean,"same_creator": boolean,"template_slug": string,"template_title": string
            }[]
                           },
"is_active_user":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_scanner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_staff":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"known_file_formats":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"log_event":
{ Args: { "p_action": string,"p_details"?: Json,"p_file_id": string,"p_target_user"?: string,"p_template_id": string }; Returns: undefined
                           },
"moderate_template":
{ Args: { "p_action": string,"p_reason"?: string,"p_template_id": string }; Returns: Database["public"]['Enums']["publication_status"]
                           },
"record_scan_result":
{ Args: { "p_file_id": string,"p_notes"?: string,"p_raw_output"?: string,"p_result": Database["public"]['Enums']["scan_status"],"p_scanned_at"?: string,"p_scanned_sha256": string,"p_scanner_name": string,"p_scanner_version": string,"p_signature_version": string }; Returns: Database["public"]['Enums']["scan_status"]
                           },
"refresh_rating":
{ Args: { "p_template_id": string }; Returns: undefined
                           },
"register_download":
{ Args: { "p_actor_hash": string,"p_file_id": string,"p_user_id": string }; Returns: boolean
                           },
"register_view":
{ Args: { "p_actor_hash": string,"p_template_id": string }; Returns: boolean
                           },
"reorder_screenshots":
{ Args: { "p_ids": (string)[],"p_template_id": string }; Returns: undefined
                           },
"resolve_report":
{ Args: { "p_note"?: string,"p_report_id": string,"p_status": Database["public"]['Enums']["report_status"] }; Returns: undefined
                           },
"search_templates":
{ Args: { "p_category"?: string,"p_creator"?: string,"p_following"?: boolean,"p_limit"?: number,"p_offset"?: number,"p_platform"?: string,"p_query"?: string,"p_sort"?: string }; Returns: {
              "approved_at": string,"category_id": string,"comment_count": number,"cover_public_key": string,"cover_thumb_key": string,"creator_avatar_key": string,"creator_display_name": string,"creator_username": string,"download_count": number,"favorite_count": number,"id": string,"is_demo": boolean,"platform_id": string,"platform_version": string,"rating_avg": number,"rating_count": number,"slug": string,"summary": string,"tags": (string)[],"title": string,"total_count": number,"view_count": number
            }[]
                           },
"shot_bytes_expr":
{ Args: { "s": Omit<Database["public"]['Tables']["template_screenshots"]['Row'], Database["public"]['Tables']["template_screenshots"]['ComputedFields']> }; Returns: number
                           },
"storage_orphans":
{ Args: { "p_limit"?: number,"p_min_age"?: string }; Returns: {
              "bucket_id": string,"name": string,"size": number
            }[]
                           },
"storage_usage":
{ Args: Record<PropertyKey, never>; Returns: {
              "file_bytes": number,"open_report_count": number,"pending_review_count": number,"pending_scan_count": number,"screenshot_bytes": number,"total_bytes": number
            }[]
                           },
"submit_template":
{ Args: { "p_template_id": string }; Returns: Database["public"]['Enums']["publication_status"]
                           },
"try_auto_publish":
{ Args: { "p_template_id": string }; Returns: boolean
                           },
"user_storage_usage":
{ Args: { "p_user_id": string }; Returns: number
                           },
"withdraw_template":
{ Args: { "p_template_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "app_role": "user"|"moderator"|"admin","publication_status": "draft"|"pending"|"approved"|"rejected"|"removed","report_kind": "abuse"|"malware"|"copyright"|"spam"|"broken"|"other","report_status": "open"|"resolved"|"dismissed","scan_status": "pending"|"clean"|"flagged"|"error","screenshot_status": "pending"|"ready"|"failed","validation_status": "pending"|"passed"|"failed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["user", "moderator", "admin"],"publication_status": ["draft", "pending", "approved", "rejected", "removed"],"report_kind": ["abuse", "malware", "copyright", "spam", "broken", "other"],"report_status": ["open", "resolved", "dismissed"],"scan_status": ["pending", "clean", "flagged", "error"],"screenshot_status": ["pending", "ready", "failed"],"validation_status": ["pending", "passed", "failed"]
          }
        }
} as const
