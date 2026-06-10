--
-- PostgreSQL database dump
--

-- Dumped from database version 17.10 (Debian 17.10-1.pgdg13+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Tenant; Type: TABLE; Schema: public; Owner: botuser
--

CREATE TABLE public."Tenant" (
    id text NOT NULL,
    nombre text NOT NULL,
    "systemPrompt" text NOT NULL,
    "woocommerceUrl" text NOT NULL,
    "consumerKey" text NOT NULL,
    "consumerSecret" text NOT NULL,
    "enabledTools" text[],
    "redisTTL" integer DEFAULT 3600 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Tenant" OWNER TO botuser;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: botuser
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO botuser;

--
-- Data for Name: Tenant; Type: TABLE DATA; Schema: public; Owner: botuser
--

COPY public."Tenant" (id, nombre, "systemPrompt", "woocommerceUrl", "consumerKey", "consumerSecret", "enabledTools", "redisTTL", "createdAt", "updatedAt") FROM stdin;
cmprh438b0002fgbkqslxem5t	Tienda REAL 1	Eres un asistente experto en Cosas del HOGAR	https://wheat-stingray-888476.hostingersite.com	ck_f633b3461119f792a6b6ccc3e567895b66198745	cs_80cbb89e5ce573cb048c895964a41fc39a9e2876	{buscar_productos}	3600	2026-05-29 22:08:19.547	2026-05-29 22:08:19.547
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: botuser
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
1fbf43ca-52cc-4b13-bafe-9b7a34b8c74f	43afaa5b6bfd3fc7e0b26527a5fdb52357f3fdd3b5190a8b2980c4364af0033b	2026-05-29 02:44:32.327201+00	20260529024432_init	\N	\N	2026-05-29 02:44:32.303323+00	1
\.


--
-- Name: Tenant Tenant_pkey; Type: CONSTRAINT; Schema: public; Owner: botuser
--

ALTER TABLE ONLY public."Tenant"
    ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: botuser
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);
