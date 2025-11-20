-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.comments (
  id integer NOT NULL DEFAULT nextval('comments_id_seq'::regclass),
  type text,
  body text,
  created_at timestamp without time zone,
  commentor text,
  commentor_id integer,
  repo_id integer,
  CONSTRAINT comments_pkey PRIMARY KEY (id),
  CONSTRAINT comments_repo_id_fkey FOREIGN KEY (repo_id) REFERENCES public.repos(repo_id)
);
CREATE TABLE public.github_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  github_username text NOT NULL UNIQUE,
  github_id integer NOT NULL UNIQUE,
  display_name text,
  avatar_url text,
  bio text,
  company text,
  location text,
  fetched_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  last_sync timestamp with time zone,
  comments_last_sync timestamp without time zone,
  CONSTRAINT github_users_pkey PRIMARY KEY (id)
);
CREATE TABLE public.repos (
  repo_id integer NOT NULL DEFAULT nextval('repos_repo_id_seq'::regclass),
  title text,
  id text,
  user_id integer,
  repository_url text,
  comments_url text,
  number integer,
  state text,
  label text[],
  total_comments integer,
  created_at timestamp without time zone,
  merged_at timestamp without time zone,
  closed_at timestamp without time zone,
  draft boolean,
  code_quality integer DEFAULT 0,
  logic_functionality integer DEFAULT 0,
  performance_security integer DEFAULT 0,
  testing_documentation integer DEFAULT 0,
  ui_ux integer DEFAULT 0,
  CONSTRAINT repos_pkey PRIMARY KEY (repo_id),
  CONSTRAINT fk_name FOREIGN KEY (user_id) REFERENCES public.github_users(github_id)
);
CREATE TABLE public.team_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  github_user_id uuid NOT NULL,
  assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  assigned_by text,
  CONSTRAINT team_members_pkey PRIMARY KEY (id),
  CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_members_github_user_id_fkey FOREIGN KEY (github_user_id) REFERENCES public.github_users(id)
);
CREATE TABLE public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  last_sync timestamp with time zone,
  CONSTRAINT teams_pkey PRIMARY KEY (id)
);