#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SQLite schema for repo runtime catalog (pages + unit tests)."""

from __future__ import annotations

SCHEMA_VERSION = 2

CATALOG_DDL = """
CREATE TABLE IF NOT EXISTS catalog_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_suite (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_page (
    nav_id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    module TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS test_module (
    module_name TEXT PRIMARY KEY,
    file_stem TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description_zh TEXT NOT NULL DEFAULT '',
    doc_path TEXT,
    case_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (suite_id) REFERENCES test_suite(id)
);

CREATE TABLE IF NOT EXISTS test_case (
    full_id TEXT PRIMARY KEY,
    case_key TEXT,
    module_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    method_name TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description_zh TEXT NOT NULL DEFAULT '',
    docstring TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (module_name) REFERENCES test_module(module_name)
);

CREATE INDEX IF NOT EXISTS idx_app_page_module ON app_page(module);
CREATE INDEX IF NOT EXISTS idx_app_page_page ON app_page(page_id);
CREATE INDEX IF NOT EXISTS idx_test_module_suite ON test_module(suite_id);
CREATE INDEX IF NOT EXISTS idx_test_case_suite ON test_case(suite_id);
CREATE INDEX IF NOT EXISTS idx_test_case_module ON test_case(module_name);
CREATE INDEX IF NOT EXISTS idx_test_case_key ON test_case(case_key);

CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(
    entity_type UNINDEXED,
    entity_id UNINDEXED,
    suite_id UNINDEXED,
    module_name UNINDEXED,
    title,
    body,
    tokenize='unicode61 remove_diacritics 0'
);
"""
