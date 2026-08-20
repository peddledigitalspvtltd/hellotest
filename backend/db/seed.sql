-- =========================
-- SEED DATA - SAP PM Mobile Automation
-- =========================

-- Roles
INSERT INTO roles (id, name) VALUES
('r1', 'admin'),
('r2', 'member');

-- Users (passwords hashed with PBKDF2-SHA256)
-- admin@testiny.ai - password: admin123
-- member@testiny.ai - password: member123
INSERT INTO users (id, email, password_hash, name) VALUES
('u1', 'admin@testiny.ai', '7752a0a257bd37b43d32b6e22132d60c6b065798e1ad9fb2c0ee68e65cac741c0e2e7dd599e3754f1de07e5b8c9038a8766f292a37fb0cf685b2020dd9339b02', 'Admin User'),
('u2', 'member@testiny.ai', '4297827f5aa1cb1aba10577e664dcf1f5744f67c70f410f63f30da5c7493cf2c9f4bde7a197bd216d3da83e40c153d73c6cdb4ddb54b584575c3a8d4cb4d17f9', 'Member User');

-- =========================
-- PROJECT: SAP PM Mobile Automation
-- =========================

INSERT INTO projects (id, name, description, created_by) VALUES
('p1', 'SAP PM Mobile Automation', 'End-to-end SAP PM preventive maintenance mobile automation flows', 'u1');

-- Project Members
INSERT INTO project_members (id, project_id, user_id, role_id) VALUES
('pm1', 'p1', 'u1', 'r1'),
('pm2', 'p1', 'u2', 'r2');

-- =========================
-- APP TYPES (5 variants: Web, API, Android, iOS, Unified)
-- =========================

INSERT INTO app_types (id, project_id, name, type, is_unified) VALUES
('a1', 'p1', 'Web Portal', 'web', FALSE),
('a2', 'p1', 'REST API', 'api', FALSE),
('a3', 'p1', 'Android App', 'android', FALSE),
('a4', 'p1', 'iOS App', 'ios', FALSE),
('a5', 'p1', 'Unified Mobile', 'unified', TRUE);

-- =========================
-- REQUIREMENTS (8 core features)
-- =========================

INSERT INTO requirements (id, project_id, title, description, priority, status) VALUES
('req1', 'p1', 'Technician Authentication', 'Technician login and sync functionality', 1, 'active'),
('req2', 'p1', 'Notification Management', 'Create and manage notifications with attachments', 1, 'active'),
('req3', 'p1', 'Work Order Processing', 'Convert notifications to work orders', 1, 'active'),
('req4', 'p1', 'Assignment & Sync', 'Assign technicians and sync data', 1, 'active'),
('req5', 'p1', 'Execution & Forms', 'Execute operations and fill forms', 1, 'active'),
('req6', 'p1', 'Permit & Safety', 'Permit approval and safety checklist', 2, 'active'),
('req7', 'p1', 'Sync & Conflict', 'Offline sync and conflict resolution', 1, 'active'),
('req8', 'p1', 'Backend Validation', 'Backend data validation and closure', 1, 'active');

-- =========================
-- TEST SUITES (8 suites × 5 app types = 40 suites total)
-- =========================

-- WEB PORTAL SUITES
INSERT INTO test_suites (id, app_type_id, name) VALUES
('ts_web_1', 'a1', 'Login & Sync'),
('ts_web_2', 'a1', 'Notification Management'),
('ts_web_3', 'a1', 'Work Order Processing'),
('ts_web_4', 'a1', 'Assignment & Sync'),
('ts_web_5', 'a1', 'Execution (Offline + Online)'),
('ts_web_6', 'a1', 'Forms & Permits'),
('ts_web_7', 'a1', 'Sync & Error Handling'),
('ts_web_8', 'a1', 'Backend Validation');

-- REST API SUITES
INSERT INTO test_suites (id, app_type_id, name) VALUES
('ts_api_1', 'a2', 'Authentication Endpoints'),
('ts_api_2', 'a2', 'Notification APIs'),
('ts_api_3', 'a2', 'Work Order APIs'),
('ts_api_4', 'a2', 'Assignment APIs'),
('ts_api_5', 'a2', 'Execution APIs'),
('ts_api_6', 'a2', 'Permit APIs'),
('ts_api_7', 'a2', 'Sync APIs'),
('ts_api_8', 'a2', 'Data Validation APIs');

-- ANDROID APP SUITES
INSERT INTO test_suites (id, app_type_id, name) VALUES
('ts_android_1', 'a3', 'Login & Sync'),
('ts_android_2', 'a3', 'Notification Management'),
('ts_android_3', 'a3', 'Work Order Processing'),
('ts_android_4', 'a3', 'Assignment & Sync'),
('ts_android_5', 'a3', 'Execution (Offline + Online)'),
('ts_android_6', 'a3', 'Forms & Permits'),
('ts_android_7', 'a3', 'Sync & Error Handling'),
('ts_android_8', 'a3', 'Backend Validation');

-- iOS APP SUITES
INSERT INTO test_suites (id, app_type_id, name) VALUES
('ts_ios_1', 'a4', 'Login & Sync'),
('ts_ios_2', 'a4', 'Notification Management'),
('ts_ios_3', 'a4', 'Work Order Processing'),
('ts_ios_4', 'a4', 'Assignment & Sync'),
('ts_ios_5', 'a4', 'Execution (Offline + Online)'),
('ts_ios_6', 'a4', 'Forms & Permits'),
('ts_ios_7', 'a4', 'Sync & Error Handling'),
('ts_ios_8', 'a4', 'Backend Validation');

-- UNIFIED MOBILE SUITES
INSERT INTO test_suites (id, app_type_id, name) VALUES
('ts_unified_1', 'a5', 'Login & Sync'),
('ts_unified_2', 'a5', 'Notification Management'),
('ts_unified_3', 'a5', 'Work Order Processing'),
('ts_unified_4', 'a5', 'Assignment & Sync'),
('ts_unified_5', 'a5', 'Execution (Offline + Online)'),
('ts_unified_6', 'a5', 'Forms & Permits'),
('ts_unified_7', 'a5', 'Sync & Error Handling'),
('ts_unified_8', 'a5', 'Backend Validation');

-- =========================
-- TEST CASES - LOGIN & SYNC (Duplicated for all 5 app types)
-- =========================

-- WEB
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_web_1_1', 'a1', 'ts_web_1', 'Technician login and initial sync', 'Verify login flow and initial data sync', 1, 'req1'),
('tc_web_1_2', 'a1', 'ts_web_1', 'Validate delta sync behavior', 'Verify delta sync updates only changed data', 1, 'req1'),
('tc_web_1_3', 'a1', 'ts_web_1', 'Validate master data integrity', 'Verify master data consistency after sync', 1, 'req1');

-- API
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_api_1_1', 'a2', 'ts_api_1', 'Authentication endpoint', 'Verify authentication API returns token', 1, 'req1'),
('tc_api_1_2', 'a2', 'ts_api_1', 'Token validation', 'Verify token validation and expiry', 1, 'req1'),
('tc_api_1_3', 'a2', 'ts_api_1', 'Refresh token', 'Verify token refresh mechanism', 1, 'req1');

-- ANDROID
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_android_1_1', 'a3', 'ts_android_1', 'Technician login and initial sync', 'Verify login flow and initial data sync on Android', 1, 'req1'),
('tc_android_1_2', 'a3', 'ts_android_1', 'Validate delta sync behavior', 'Verify delta sync on Android device', 1, 'req1'),
('tc_android_1_3', 'a3', 'ts_android_1', 'Validate master data integrity', 'Verify master data on Android', 1, 'req1');

-- iOS
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_ios_1_1', 'a4', 'ts_ios_1', 'Technician login and initial sync', 'Verify login flow and initial data sync on iOS', 1, 'req1'),
('tc_ios_1_2', 'a4', 'ts_ios_1', 'Validate delta sync behavior', 'Verify delta sync on iOS device', 1, 'req1'),
('tc_ios_1_3', 'a4', 'ts_ios_1', 'Validate master data integrity', 'Verify master data on iOS', 1, 'req1');

-- UNIFIED
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_unified_1_1', 'a5', 'ts_unified_1', 'Technician login and initial sync', 'Verify unified login flow and sync', 1, 'req1'),
('tc_unified_1_2', 'a5', 'ts_unified_1', 'Validate delta sync behavior', 'Verify delta sync on unified platform', 1, 'req1'),
('tc_unified_1_3', 'a5', 'ts_unified_1', 'Validate master data integrity', 'Verify master data consistency', 1, 'req1');

-- =========================
-- TEST CASES - NOTIFICATION MANAGEMENT (6 per app type)
-- =========================

-- WEB
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_web_2_1', 'a1', 'ts_web_2', 'Create notification', 'Verify notification creation flow', 1, 'req2'),
('tc_web_2_2', 'a1', 'ts_web_2', 'Add items/causes/activities', 'Add notification details', 1, 'req2'),
('tc_web_2_3', 'a1', 'ts_web_2', 'Add attachments', 'Upload photos and documents', 1, 'req2'),
('tc_web_2_4', 'a1', 'ts_web_2', 'Save draft notification', 'Save incomplete notification as draft', 2, 'req2'),
('tc_web_2_5', 'a1', 'ts_web_2', 'Reopen draft notification', 'Resume editing saved draft', 2, 'req2'),
('tc_web_2_6', 'a1', 'ts_web_2', 'Submit notification', 'Submit completed notification', 1, 'req2');

-- API
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_api_2_1', 'a2', 'ts_api_2', 'Create notification API', 'POST /notifications endpoint', 1, 'req2'),
('tc_api_2_2', 'a2', 'ts_api_2', 'Get notification API', 'GET /notifications endpoint', 1, 'req2'),
('tc_api_2_3', 'a2', 'ts_api_2', 'Update notification API', 'PATCH /notifications endpoint', 1, 'req2'),
('tc_api_2_4', 'a2', 'ts_api_2', 'List notifications API', 'GET /notifications/list endpoint', 1, 'req2'),
('tc_api_2_5', 'a2', 'ts_api_2', 'Attachment upload API', 'POST /notifications/attachments endpoint', 1, 'req2'),
('tc_api_2_6', 'a2', 'ts_api_2', 'Submit notification API', 'POST /notifications/submit endpoint', 1, 'req2');

-- ANDROID
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_android_2_1', 'a3', 'ts_android_2', 'Create notification', 'Verify notification creation on Android', 1, 'req2'),
('tc_android_2_2', 'a3', 'ts_android_2', 'Add items/causes/activities', 'Add notification details on Android', 1, 'req2'),
('tc_android_2_3', 'a3', 'ts_android_2', 'Add attachments', 'Upload photos on Android', 1, 'req2'),
('tc_android_2_4', 'a3', 'ts_android_2', 'Save draft notification', 'Save draft on Android', 2, 'req2'),
('tc_android_2_5', 'a3', 'ts_android_2', 'Reopen draft notification', 'Resume draft on Android', 2, 'req2'),
('tc_android_2_6', 'a3', 'ts_android_2', 'Submit notification', 'Submit on Android', 1, 'req2');

-- iOS
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_ios_2_1', 'a4', 'ts_ios_2', 'Create notification', 'Verify notification creation on iOS', 1, 'req2'),
('tc_ios_2_2', 'a4', 'ts_ios_2', 'Add items/causes/activities', 'Add notification details on iOS', 1, 'req2'),
('tc_ios_2_3', 'a4', 'ts_ios_2', 'Add attachments', 'Upload photos on iOS', 1, 'req2'),
('tc_ios_2_4', 'a4', 'ts_ios_2', 'Save draft notification', 'Save draft on iOS', 2, 'req2'),
('tc_ios_2_5', 'a4', 'ts_ios_2', 'Reopen draft notification', 'Resume draft on iOS', 2, 'req2'),
('tc_ios_2_6', 'a4', 'ts_ios_2', 'Submit notification', 'Submit on iOS', 1, 'req2');

-- UNIFIED
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_unified_2_1', 'a5', 'ts_unified_2', 'Create notification', 'Verify notification creation unified', 1, 'req2'),
('tc_unified_2_2', 'a5', 'ts_unified_2', 'Add items/causes/activities', 'Add notification details unified', 1, 'req2'),
('tc_unified_2_3', 'a5', 'ts_unified_2', 'Add attachments', 'Upload photos unified', 1, 'req2'),
('tc_unified_2_4', 'a5', 'ts_unified_2', 'Save draft notification', 'Save draft unified', 2, 'req2'),
('tc_unified_2_5', 'a5', 'ts_unified_2', 'Reopen draft notification', 'Resume draft unified', 2, 'req2'),
('tc_unified_2_6', 'a5', 'ts_unified_2', 'Submit notification', 'Submit unified', 1, 'req2');

-- =========================
-- TEST CASES - WORK ORDER PROCESSING (3 per app type - shortened)
-- =========================

-- WEB
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_web_3_1', 'a1', 'ts_web_3', 'Review notification', 'Review submitted notification', 1, 'req3'),
('tc_web_3_2', 'a1', 'ts_web_3', 'Approve notification', 'Approve notification for WO creation', 1, 'req3'),
('tc_web_3_3', 'a1', 'ts_web_3', 'Convert to work order', 'Create work order from notification', 1, 'req3');

-- API
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_api_3_1', 'a2', 'ts_api_3', 'List work orders API', 'GET /workorders endpoint', 1, 'req3'),
('tc_api_3_2', 'a2', 'ts_api_3', 'Create work order API', 'POST /workorders endpoint', 1, 'req3'),
('tc_api_3_3', 'a2', 'ts_api_3', 'Update work order API', 'PATCH /workorders endpoint', 1, 'req3');

-- ANDROID
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_android_3_1', 'a3', 'ts_android_3', 'Review notification', 'Review notification on Android', 1, 'req3'),
('tc_android_3_2', 'a3', 'ts_android_3', 'Approve notification', 'Approve on Android', 1, 'req3'),
('tc_android_3_3', 'a3', 'ts_android_3', 'Convert to work order', 'Convert on Android', 1, 'req3');

-- iOS
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_ios_3_1', 'a4', 'ts_ios_3', 'Review notification', 'Review notification on iOS', 1, 'req3'),
('tc_ios_3_2', 'a4', 'ts_ios_3', 'Approve notification', 'Approve on iOS', 1, 'req3'),
('tc_ios_3_3', 'a4', 'ts_ios_3', 'Convert to work order', 'Convert on iOS', 1, 'req3');

-- UNIFIED
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_unified_3_1', 'a5', 'ts_unified_3', 'Review notification', 'Review notification unified', 1, 'req3'),
('tc_unified_3_2', 'a5', 'ts_unified_3', 'Approve notification', 'Approve unified', 1, 'req3'),
('tc_unified_3_3', 'a5', 'ts_unified_3', 'Convert to work order', 'Convert unified', 1, 'req3');

-- =========================
-- TEST CASES - ASSIGNMENT & SYNC (2 per app type)
-- =========================

-- WEB
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_web_4_1', 'a1', 'ts_web_4', 'Assign technician', 'Assign work order to technician', 1, 'req4'),
('tc_web_4_2', 'a1', 'ts_web_4', 'Sync assigned WO', 'Sync assigned work orders', 1, 'req4');

-- API
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_api_4_1', 'a2', 'ts_api_4', 'Assign technician API', 'POST /assignments endpoint', 1, 'req4'),
('tc_api_4_2', 'a2', 'ts_api_4', 'Sync data API', 'POST /sync endpoint', 1, 'req4');

-- ANDROID
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_android_4_1', 'a3', 'ts_android_4', 'Assign technician', 'Assign on Android', 1, 'req4'),
('tc_android_4_2', 'a3', 'ts_android_4', 'Sync assigned WO', 'Sync on Android', 1, 'req4');

-- iOS
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_ios_4_1', 'a4', 'ts_ios_4', 'Assign technician', 'Assign on iOS', 1, 'req4'),
('tc_ios_4_2', 'a4', 'ts_ios_4', 'Sync assigned WO', 'Sync on iOS', 1, 'req4');

-- UNIFIED
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_unified_4_1', 'a5', 'ts_unified_4', 'Assign technician', 'Assign unified', 1, 'req4'),
('tc_unified_4_2', 'a5', 'ts_unified_4', 'Sync assigned WO', 'Sync unified', 1, 'req4');

-- =========================
-- TEST CASES - EXECUTION (3 per app type)
-- =========================

-- WEB
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_web_5_1', 'a1', 'ts_web_5', 'Start execution', 'Begin WO execution', 1, 'req5'),
('tc_web_5_2', 'a1', 'ts_web_5', 'Update operations', 'Mark operations as complete', 1, 'req5'),
('tc_web_5_3', 'a1', 'ts_web_5', 'Complete form', 'Submit completed execution', 1, 'req5');

-- API
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_api_5_1', 'a2', 'ts_api_5', 'Start execution API', 'POST /executions/start endpoint', 1, 'req5'),
('tc_api_5_2', 'a2', 'ts_api_5', 'Update execution API', 'PATCH /executions endpoint', 1, 'req5'),
('tc_api_5_3', 'a2', 'ts_api_5', 'Complete execution API', 'POST /executions/complete endpoint', 1, 'req5');

-- ANDROID
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_android_5_1', 'a3', 'ts_android_5', 'Start execution', 'Begin on Android', 1, 'req5'),
('tc_android_5_2', 'a3', 'ts_android_5', 'Update operations', 'Update on Android', 1, 'req5'),
('tc_android_5_3', 'a3', 'ts_android_5', 'Complete form', 'Complete on Android', 1, 'req5');

-- iOS
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_ios_5_1', 'a4', 'ts_ios_5', 'Start execution', 'Begin on iOS', 1, 'req5'),
('tc_ios_5_2', 'a4', 'ts_ios_5', 'Update operations', 'Update on iOS', 1, 'req5'),
('tc_ios_5_3', 'a4', 'ts_ios_5', 'Complete form', 'Complete on iOS', 1, 'req5');

-- UNIFIED
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_unified_5_1', 'a5', 'ts_unified_5', 'Start execution', 'Begin unified', 1, 'req5'),
('tc_unified_5_2', 'a5', 'ts_unified_5', 'Update operations', 'Update unified', 1, 'req5'),
('tc_unified_5_3', 'a5', 'ts_unified_5', 'Complete form', 'Complete unified', 1, 'req5');

-- =========================
-- TEST CASES - PERMITS & FORMS (2 per app type)
-- =========================

-- WEB
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_web_6_1', 'a1', 'ts_web_6', 'Permit approval', 'Approve safety permits', 1, 'req6'),
('tc_web_6_2', 'a1', 'ts_web_6', 'Safety checklist', 'Validate safety checklist completion', 1, 'req6');

-- API
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_api_6_1', 'a2', 'ts_api_6', 'Permit approval API', 'POST /permits/approve endpoint', 1, 'req6'),
('tc_api_6_2', 'a2', 'ts_api_6', 'Checklist API', 'POST /checklist endpoint', 1, 'req6');

-- ANDROID
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_android_6_1', 'a3', 'ts_android_6', 'Permit approval', 'Approve on Android', 1, 'req6'),
('tc_android_6_2', 'a3', 'ts_android_6', 'Safety checklist', 'Checklist on Android', 1, 'req6');

-- iOS
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_ios_6_1', 'a4', 'ts_ios_6', 'Permit approval', 'Approve on iOS', 1, 'req6'),
('tc_ios_6_2', 'a4', 'ts_ios_6', 'Safety checklist', 'Checklist on iOS', 1, 'req6');

-- UNIFIED
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_unified_6_1', 'a5', 'ts_unified_6', 'Permit approval', 'Approve unified', 1, 'req6'),
('tc_unified_6_2', 'a5', 'ts_unified_6', 'Safety checklist', 'Checklist unified', 1, 'req6');

-- =========================
-- TEST CASES - SYNC & ERROR HANDLING (2 per app type)
-- =========================

-- WEB
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_web_7_1', 'a1', 'ts_web_7', 'Offline sync', 'Complete WO execution offline', 1, 'req7'),
('tc_web_7_2', 'a1', 'ts_web_7', 'Conflict resolution', 'Resolve data conflicts', 1, 'req7');

-- API
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_api_7_1', 'a2', 'ts_api_7', 'Offline queue API', 'POST /sync/queue endpoint', 1, 'req7'),
('tc_api_7_2', 'a2', 'ts_api_7', 'Conflict resolution API', 'POST /sync/resolve endpoint', 1, 'req7');

-- ANDROID
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_android_7_1', 'a3', 'ts_android_7', 'Offline sync', 'Offline on Android', 1, 'req7'),
('tc_android_7_2', 'a3', 'ts_android_7', 'Conflict resolution', 'Conflict on Android', 1, 'req7');

-- iOS
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_ios_7_1', 'a4', 'ts_ios_7', 'Offline sync', 'Offline on iOS', 1, 'req7'),
('tc_ios_7_2', 'a4', 'ts_ios_7', 'Conflict resolution', 'Conflict on iOS', 1, 'req7');

-- UNIFIED
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_unified_7_1', 'a5', 'ts_unified_7', 'Offline sync', 'Offline unified', 1, 'req7'),
('tc_unified_7_2', 'a5', 'ts_unified_7', 'Conflict resolution', 'Conflict unified', 1, 'req7');

-- =========================
-- TEST CASES - BACKEND VALIDATION (2 per app type)
-- =========================

-- WEB
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_web_8_1', 'a1', 'ts_web_8', 'Data validation', 'Verify backend database integrity', 1, 'req8'),
('tc_web_8_2', 'a1', 'ts_web_8', 'Cross-system validation', 'Verify integration with external systems', 2, 'req8');

-- API
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_api_8_1', 'a2', 'ts_api_8', 'Database validation API', 'GET /validate/db endpoint', 1, 'req8'),
('tc_api_8_2', 'a2', 'ts_api_8', 'System integration API', 'GET /validate/system endpoint', 2, 'req8');

-- ANDROID
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_android_8_1', 'a3', 'ts_android_8', 'Data validation', 'Data validation on Android', 1, 'req8'),
('tc_android_8_2', 'a3', 'ts_android_8', 'Cross-system validation', 'System validation on Android', 2, 'req8');

-- iOS
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_ios_8_1', 'a4', 'ts_ios_8', 'Data validation', 'Data validation on iOS', 1, 'req8'),
('tc_ios_8_2', 'a4', 'ts_ios_8', 'Cross-system validation', 'System validation on iOS', 2, 'req8');

-- UNIFIED
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, priority, requirement_id) VALUES
('tc_unified_8_1', 'a5', 'ts_unified_8', 'Data validation', 'Data validation unified', 1, 'req8'),
('tc_unified_8_2', 'a5', 'ts_unified_8', 'Cross-system validation', 'System validation unified', 2, 'req8');

-- =========================
-- TEST STEPS (Sample for critical flows)
-- =========================

-- Login steps for Web
INSERT INTO test_steps (id, test_case_id, step_order, action, expected_result) VALUES
('step_web_1_1_1', 'tc_web_1_1', 1, 'Open web portal', 'Login page displayed'),
('step_web_1_1_2', 'tc_web_1_1', 2, 'Enter credentials', 'Email and password accepted'),
('step_web_1_1_3', 'tc_web_1_1', 3, 'Click login button', 'Authentication initiated'),
('step_web_1_1_4', 'tc_web_1_1', 4, 'Verify sync starts', 'Sync indicator shown'),
('step_web_1_1_5', 'tc_web_1_1', 5, 'Wait for completion', 'Dashboard loaded with data');

-- Notification creation steps for Web
INSERT INTO test_steps (id, test_case_id, step_order, action, expected_result) VALUES
('step_web_2_1_1', 'tc_web_2_1', 1, 'Click Create Notification', 'Notification form displayed'),
('step_web_2_1_2', 'tc_web_2_1', 2, 'Fill notification details', 'Form fields populated'),
('step_web_2_1_3', 'tc_web_2_1', 3, 'Select equipment', 'Equipment linked'),
('step_web_2_1_4', 'tc_web_2_1', 4, 'Set priority', 'Priority selected'),
('step_web_2_1_5', 'tc_web_2_1', 5, 'Validate form', 'All required fields validated');

-- =========================
-- SUITE TEST CASES MAPPINGS (Critical relationships)
-- =========================

-- WEB SUITE MAPPINGS
INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order) VALUES
('ts_web_1', 'tc_web_1_1', 1), ('ts_web_1', 'tc_web_1_2', 2), ('ts_web_1', 'tc_web_1_3', 3),
('ts_web_2', 'tc_web_2_1', 1), ('ts_web_2', 'tc_web_2_2', 2), ('ts_web_2', 'tc_web_2_3', 3),
('ts_web_2', 'tc_web_2_4', 4), ('ts_web_2', 'tc_web_2_5', 5), ('ts_web_2', 'tc_web_2_6', 6),
('ts_web_3', 'tc_web_3_1', 1), ('ts_web_3', 'tc_web_3_2', 2), ('ts_web_3', 'tc_web_3_3', 3),
('ts_web_4', 'tc_web_4_1', 1), ('ts_web_4', 'tc_web_4_2', 2),
('ts_web_5', 'tc_web_5_1', 1), ('ts_web_5', 'tc_web_5_2', 2), ('ts_web_5', 'tc_web_5_3', 3),
('ts_web_6', 'tc_web_6_1', 1), ('ts_web_6', 'tc_web_6_2', 2),
('ts_web_7', 'tc_web_7_1', 1), ('ts_web_7', 'tc_web_7_2', 2),
('ts_web_8', 'tc_web_8_1', 1), ('ts_web_8', 'tc_web_8_2', 2);

-- API SUITE MAPPINGS
INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order) VALUES
('ts_api_1', 'tc_api_1_1', 1), ('ts_api_1', 'tc_api_1_2', 2), ('ts_api_1', 'tc_api_1_3', 3),
('ts_api_2', 'tc_api_2_1', 1), ('ts_api_2', 'tc_api_2_2', 2), ('ts_api_2', 'tc_api_2_3', 3),
('ts_api_2', 'tc_api_2_4', 4), ('ts_api_2', 'tc_api_2_5', 5), ('ts_api_2', 'tc_api_2_6', 6),
('ts_api_3', 'tc_api_3_1', 1), ('ts_api_3', 'tc_api_3_2', 2), ('ts_api_3', 'tc_api_3_3', 3),
('ts_api_4', 'tc_api_4_1', 1), ('ts_api_4', 'tc_api_4_2', 2),
('ts_api_5', 'tc_api_5_1', 1), ('ts_api_5', 'tc_api_5_2', 2), ('ts_api_5', 'tc_api_5_3', 3),
('ts_api_6', 'tc_api_6_1', 1), ('ts_api_6', 'tc_api_6_2', 2),
('ts_api_7', 'tc_api_7_1', 1), ('ts_api_7', 'tc_api_7_2', 2),
('ts_api_8', 'tc_api_8_1', 1), ('ts_api_8', 'tc_api_8_2', 2);

-- ANDROID SUITE MAPPINGS
INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order) VALUES
('ts_android_1', 'tc_android_1_1', 1), ('ts_android_1', 'tc_android_1_2', 2), ('ts_android_1', 'tc_android_1_3', 3),
('ts_android_2', 'tc_android_2_1', 1), ('ts_android_2', 'tc_android_2_2', 2), ('ts_android_2', 'tc_android_2_3', 3),
('ts_android_2', 'tc_android_2_4', 4), ('ts_android_2', 'tc_android_2_5', 5), ('ts_android_2', 'tc_android_2_6', 6),
('ts_android_3', 'tc_android_3_1', 1), ('ts_android_3', 'tc_android_3_2', 2), ('ts_android_3', 'tc_android_3_3', 3),
('ts_android_4', 'tc_android_4_1', 1), ('ts_android_4', 'tc_android_4_2', 2),
('ts_android_5', 'tc_android_5_1', 1), ('ts_android_5', 'tc_android_5_2', 2), ('ts_android_5', 'tc_android_5_3', 3),
('ts_android_6', 'tc_android_6_1', 1), ('ts_android_6', 'tc_android_6_2', 2),
('ts_android_7', 'tc_android_7_1', 1), ('ts_android_7', 'tc_android_7_2', 2),
('ts_android_8', 'tc_android_8_1', 1), ('ts_android_8', 'tc_android_8_2', 2);

-- iOS SUITE MAPPINGS
INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order) VALUES
('ts_ios_1', 'tc_ios_1_1', 1), ('ts_ios_1', 'tc_ios_1_2', 2), ('ts_ios_1', 'tc_ios_1_3', 3),
('ts_ios_2', 'tc_ios_2_1', 1), ('ts_ios_2', 'tc_ios_2_2', 2), ('ts_ios_2', 'tc_ios_2_3', 3),
('ts_ios_2', 'tc_ios_2_4', 4), ('ts_ios_2', 'tc_ios_2_5', 5), ('ts_ios_2', 'tc_ios_2_6', 6),
('ts_ios_3', 'tc_ios_3_1', 1), ('ts_ios_3', 'tc_ios_3_2', 2), ('ts_ios_3', 'tc_ios_3_3', 3),
('ts_ios_4', 'tc_ios_4_1', 1), ('ts_ios_4', 'tc_ios_4_2', 2),
('ts_ios_5', 'tc_ios_5_1', 1), ('ts_ios_5', 'tc_ios_5_2', 2), ('ts_ios_5', 'tc_ios_5_3', 3),
('ts_ios_6', 'tc_ios_6_1', 1), ('ts_ios_6', 'tc_ios_6_2', 2),
('ts_ios_7', 'tc_ios_7_1', 1), ('ts_ios_7', 'tc_ios_7_2', 2),
('ts_ios_8', 'tc_ios_8_1', 1), ('ts_ios_8', 'tc_ios_8_2', 2);

-- UNIFIED SUITE MAPPINGS
INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order) VALUES
('ts_unified_1', 'tc_unified_1_1', 1), ('ts_unified_1', 'tc_unified_1_2', 2), ('ts_unified_1', 'tc_unified_1_3', 3),
('ts_unified_2', 'tc_unified_2_1', 1), ('ts_unified_2', 'tc_unified_2_2', 2), ('ts_unified_2', 'tc_unified_2_3', 3),
('ts_unified_2', 'tc_unified_2_4', 4), ('ts_unified_2', 'tc_unified_2_5', 5), ('ts_unified_2', 'tc_unified_2_6', 6),
('ts_unified_3', 'tc_unified_3_1', 1), ('ts_unified_3', 'tc_unified_3_2', 2), ('ts_unified_3', 'tc_unified_3_3', 3),
('ts_unified_4', 'tc_unified_4_1', 1), ('ts_unified_4', 'tc_unified_4_2', 2),
('ts_unified_5', 'tc_unified_5_1', 1), ('ts_unified_5', 'tc_unified_5_2', 2), ('ts_unified_5', 'tc_unified_5_3', 3),
('ts_unified_6', 'tc_unified_6_1', 1), ('ts_unified_6', 'tc_unified_6_2', 2),
('ts_unified_7', 'tc_unified_7_1', 1), ('ts_unified_7', 'tc_unified_7_2', 2),
('ts_unified_8', 'tc_unified_8_1', 1), ('ts_unified_8', 'tc_unified_8_2', 2);

-- =========================
-- EXECUTIONS (Sample runs for different platforms)
-- =========================

-- WEB PORTAL EXECUTIONS
INSERT INTO executions (id, project_id, app_type_id, name, trigger, status, created_by, started_at, ended_at) VALUES
('exec_web_1', 'p1', 'a1', 'Web Portal - Smoke Test', 'manual', 'completed', 'u1', CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '2 days' + INTERVAL '2 hours'),
('exec_web_2', 'p1', 'a1', 'Web Portal - Regression Test', 'manual', 'completed', 'u2', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '3 hours'),
('exec_web_3', 'p1', 'a1', 'Web Portal - Critical Path', 'ci', 'running', 'u1', CURRENT_TIMESTAMP, NULL);

-- ANDROID APP EXECUTIONS
INSERT INTO executions (id, project_id, app_type_id, name, trigger, status, created_by, started_at, ended_at) VALUES
('exec_android_1', 'p1', 'a3', 'Android - Smoke Test', 'manual', 'completed', 'u1', CURRENT_TIMESTAMP - INTERVAL '3 days', CURRENT_TIMESTAMP - INTERVAL '3 days' + INTERVAL '90 minutes'),
('exec_android_2', 'p1', 'a3', 'Android - Full Test Suite', 'manual', 'completed', 'u2', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '4 hours'),
('exec_android_3', 'p1', 'a3', 'Android - Offline Sync', 'manual', 'running', 'u1', CURRENT_TIMESTAMP - INTERVAL '4 hours', NULL);

-- iOS APP EXECUTIONS
INSERT INTO executions (id, project_id, app_type_id, name, trigger, status, created_by, started_at, ended_at) VALUES
('exec_ios_1', 'p1', 'a4', 'iOS - Smoke Test', 'manual', 'completed', 'u1', CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '2 days' + INTERVAL '2 hours'),
('exec_ios_2', 'p1', 'a4', 'iOS - Regression', 'manual', 'completed', 'u2', CURRENT_TIMESTAMP - INTERVAL '12 hours', CURRENT_TIMESTAMP - INTERVAL '12 hours' + INTERVAL '3 hours'),
('exec_ios_3', 'p1', 'a4', 'iOS - Notifications', 'ci', 'failed', 'u1', CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP - INTERVAL '6 hours' + INTERVAL '1 hour');

-- API EXECUTIONS
INSERT INTO executions (id, project_id, app_type_id, name, trigger, status, created_by, started_at, ended_at) VALUES
('exec_api_1', 'p1', 'a2', 'API - Contract Testing', 'ci', 'completed', 'u1', CURRENT_TIMESTAMP - INTERVAL '4 hours', CURRENT_TIMESTAMP - INTERVAL '4 hours' + INTERVAL '1 hour'),
('exec_api_2', 'p1', 'a2', 'API - Load Testing', 'manual', 'running', 'u2', CURRENT_TIMESTAMP - INTERVAL '2 hours', NULL);

-- UNIFIED PLATFORM EXECUTIONS
INSERT INTO executions (id, project_id, app_type_id, name, trigger, status, created_by, started_at, ended_at) VALUES
('exec_unified_1', 'p1', 'a5', 'Unified - Cross Platform', 'manual', 'completed', 'u1', CURRENT_TIMESTAMP - INTERVAL '3 days', CURRENT_TIMESTAMP - INTERVAL '3 days' + INTERVAL '5 hours'),
('exec_unified_2', 'p1', 'a5', 'Unified - End-to-End', 'manual', 'completed', 'u2', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '4 hours');

-- =========================
-- EXECUTION SUITES (Link suites to executions)
-- =========================

-- Web Portal Execution 1
INSERT INTO execution_suites (execution_id, suite_id, suite_name) VALUES
('exec_web_1', 'ts_web_1', 'Login & Sync'),
('exec_web_1', 'ts_web_2', 'Notification Management');

-- Web Portal Execution 2
INSERT INTO execution_suites (execution_id, suite_id, suite_name) VALUES
('exec_web_2', 'ts_web_1', 'Login & Sync'),
('exec_web_2', 'ts_web_2', 'Notification Management'),
('exec_web_2', 'ts_web_3', 'Work Order Processing'),
('exec_web_2', 'ts_web_4', 'Assignment & Sync');

-- Android Execution 1
INSERT INTO execution_suites (execution_id, suite_id, suite_name) VALUES
('exec_android_1', 'ts_android_1', 'Login & Sync'),
('exec_android_1', 'ts_android_2', 'Notification Management');

-- iOS Execution 1
INSERT INTO execution_suites (execution_id, suite_id, suite_name) VALUES
('exec_ios_1', 'ts_ios_1', 'Login & Sync'),
('exec_ios_1', 'ts_ios_2', 'Notification Management');

-- Unified Execution 1
INSERT INTO execution_suites (execution_id, suite_id, suite_name) VALUES
('exec_unified_1', 'ts_unified_1', 'Login & Sync'),
('exec_unified_1', 'ts_unified_2', 'Notification Management'),
('exec_unified_1', 'ts_unified_5', 'Execution (Offline + Online)');

-- =========================
-- EXECUTION RESULTS (Sample test results)
-- =========================

-- Web Portal Smoke Test Results
INSERT INTO execution_results (id, execution_id, test_case_id, test_case_title, suite_id, suite_name, app_type_id, status, duration_ms, executed_by) VALUES
('er_web_1_1', 'exec_web_1', 'tc_web_1_1', 'Technician login and initial sync', 'ts_web_1', 'Login & Sync', 'a1', 'passed', 1200, 'u2'),
('er_web_1_2', 'exec_web_1', 'tc_web_1_2', 'Validate delta sync behavior', 'ts_web_1', 'Login & Sync', 'a1', 'passed', 950, 'u2'),
('er_web_1_3', 'exec_web_1', 'tc_web_2_1', 'Create notification', 'ts_web_2', 'Notification Management', 'a1', 'passed', 1500, 'u2'),
('er_web_1_4', 'exec_web_1', 'tc_web_2_6', 'Submit notification', 'ts_web_2', 'Notification Management', 'a1', 'passed', 2000, 'u2');

-- Web Portal Regression Test Results
INSERT INTO execution_results (id, execution_id, test_case_id, test_case_title, suite_id, suite_name, app_type_id, status, duration_ms, executed_by) VALUES
('er_web_2_1', 'exec_web_2', 'tc_web_1_1', 'Technician login and initial sync', 'ts_web_1', 'Login & Sync', 'a1', 'passed', 1100, 'u2'),
('er_web_2_2', 'exec_web_2', 'tc_web_2_1', 'Create notification', 'ts_web_2', 'Notification Management', 'a1', 'passed', 1600, 'u2'),
('er_web_2_3', 'exec_web_2', 'tc_web_3_1', 'Review notification', 'ts_web_3', 'Work Order Processing', 'a1', 'passed', 1300, 'u2'),
('er_web_2_4', 'exec_web_2', 'tc_web_3_3', 'Convert to work order', 'ts_web_3', 'Work Order Processing', 'a1', 'failed', 2100, 'u2');

-- Android Smoke Test Results
INSERT INTO execution_results (id, execution_id, test_case_id, test_case_title, suite_id, suite_name, app_type_id, status, duration_ms, executed_by) VALUES
('er_android_1_1', 'exec_android_1', 'tc_android_1_1', 'Technician login and initial sync', 'ts_android_1', 'Login & Sync', 'a3', 'passed', 1800, 'u2'),
('er_android_1_2', 'exec_android_1', 'tc_android_2_1', 'Create notification', 'ts_android_2', 'Notification Management', 'a3', 'passed', 2200, 'u2');

-- iOS Smoke Test Results
INSERT INTO execution_results (id, execution_id, test_case_id, test_case_title, suite_id, suite_name, app_type_id, status, duration_ms, executed_by) VALUES
('er_ios_1_1', 'exec_ios_1', 'tc_ios_1_1', 'Technician login and initial sync', 'ts_ios_1', 'Login & Sync', 'a4', 'passed', 1700, 'u2'),
('er_ios_1_2', 'exec_ios_1', 'tc_ios_2_1', 'Create notification', 'ts_ios_2', 'Notification Management', 'a4', 'blocked', 2500, 'u2');

-- =========================
-- FEEDBACK
-- =========================

INSERT INTO feedback (id, project_id, user_id, title, message, status) VALUES
('fb1', 'p1', 'u1', 'Bulk import flow', 'Would love a CSV import for requirements and test cases.', 'open'),
('fb2', 'p1', 'u2', 'Execution notes', 'A dedicated notes area during execution would help triage faster.', 'reviewed'),
('fb3', 'p1', 'u1', 'Mobile sync optimization', 'Sync performance needs improvement for large datasets.', 'open');

-- =========================
-- RUNTIME SEED ENHANCEMENTS
-- =========================

UPDATE users
SET
  is_workspace_admin = CASE WHEN id = 'u1' THEN TRUE ELSE FALSE END,
  auth_provider = 'local',
  email_verified = TRUE;

INSERT INTO integrations (
  id,
  type,
  name,
  base_url,
  api_key,
  model,
  project_key,
  username,
  config,
  is_active
)
VALUES
(
  'edff6911-be06-405b-8c88-261ba8bb962e',
  'testengine',
  'Test Engine',
  'http://localhost:4301',
  NULL,
  NULL,
  NULL,
  NULL,
  '{
    "project_id":null,
    "runner":"hybrid",
    "dispatch_mode":"qaira-pull",
    "execution_scope":"api+web",
    "active_web_engine":"playwright",
    "browser":"chromium",
    "headless":true,
    "healing_enabled":false,
    "max_repair_attempts":0,
    "trace_mode":"off",
    "video_mode":"retain-on-failure",
    "capture_console":true,
    "capture_network":true,
    "artifact_retention_days":7,
    "run_timeout_seconds":1800,
    "navigation_timeout_ms":30000,
    "action_timeout_ms":5000,
    "assertion_timeout_ms":10000,
    "recovery_wait_ms":750,
    "max_video_attachment_mb":25,
    "queue_poll_interval_minutes":1,
    "qaira_api_base_url":"http://localhost:3000",
    "promote_healed_patches":"review",
    "public_base_url":"http://localhost:4301",
    "recorder_public_base_url":"http://localhost:4301",
    "ops_public_base_url":"http://localhost:4301",
    "live_view_url":"http://localhost:4301/api/v1/live-session?provider=playwright",
    "mobile_engine_url":"http://localhost:4312",
    "mobile_engine_internal_url":"http://localhost:4312",
    "appium_server_url":"http://localhost:4723"
  }'::jsonb,
  TRUE
),
(
  '382a96b2-fbed-4e1a-9a7a-50c0b399df60',
  'google_auth',
  'HelloTest',
  'https://api.openai.com/v1',
  NULL,
  NULL,
  NULL,
  NULL,
  '{"client_id":"918974800113-i8i5r0im3705u8gceqbploemv3oeg32i.apps.googleusercontent.com"}'::jsonb,
  TRUE
),
(
  '08f12517-6229-4e4c-a6d2-4f88145fbff1',
  'ops',
  'HelloTest',
  'http://localhost:4301',
  NULL,
  NULL,
  NULL,
  NULL,
  '{
    "project_id":null,
    "events_path":"/api/v1/events",
    "health_path":"/health",
    "api_key_header":"Authorization",
    "api_key_prefix":"Bearer",
    "service_name":"qaira-testengine",
    "environment":"local",
    "timeout_ms":4000,
    "emit_step_events":true,
    "emit_case_events":true,
    "emit_suite_events":true,
    "emit_run_events":true
  }'::jsonb,
  TRUE
),
(
  '17fa4724-6516-4ff2-b2aa-e7d27fe605b3',
  'llm',
  'Open AI',
  'https://api.openai.com/v1',
  '********',
  'gpt-5.4-mini',
  NULL,
  NULL,
  '{}'::jsonb,
  TRUE
),
(
  'df45e7d9-5167-4b30-a766-3c92a2a27a99',
  'email',
  'HelloTest',
  'https://api.openai.com/v1',
  NULL,
  NULL,
  NULL,
  'contact@qualipal.in',
  '{
    "host":"smtp.hostinger.com",
    "port":587,
    "secure":false,
    "password":"********",
    "sender_email":"contact@qualipal.in",
    "sender_name":"HelloTest Support"
  }'::jsonb,
  TRUE
),
(
  '3078d5bf-993d-4aeb-9ff2-e2ea0d93c42a',
  'llm',
  'grok',
  'https://api.groq.com/openai/v1',
  '********',
  'openai/gpt-oss-20b',
  NULL,
  NULL,
  '{}'::jsonb,
  TRUE
);

WITH ordered_projects AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
  FROM projects
)
UPDATE projects
SET display_id = 'PROJ-' || ordered_projects.seq
FROM ordered_projects
WHERE projects.id = ordered_projects.id;

WITH ordered_requirements AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
  FROM requirements
)
UPDATE requirements
SET
  display_id = 'Req_' || ordered_requirements.seq,
  created_by = COALESCE(created_by, 'u1'),
  updated_by = COALESCE(updated_by, 'u1'),
  updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
FROM ordered_requirements
WHERE requirements.id = ordered_requirements.id;

WITH ordered_suites AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
  FROM test_suites
)
UPDATE test_suites
SET
  display_id = 'TS-' || ordered_suites.seq,
  parameter_values = COALESCE(parameter_values, '{}'::jsonb),
  created_by = COALESCE(created_by, 'u1'),
  updated_by = COALESCE(updated_by, 'u1'),
  updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
FROM ordered_suites
WHERE test_suites.id = ordered_suites.id;

WITH ordered_cases AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
  FROM test_cases
)
UPDATE test_cases
SET
  display_id = 'TC_' || ordered_cases.seq,
  parameter_values = COALESCE(parameter_values, '{}'::jsonb),
  created_by = COALESCE(created_by, 'u1'),
  updated_by = COALESCE(updated_by, 'u1'),
  updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
FROM ordered_cases
WHERE test_cases.id = ordered_cases.id;

UPDATE test_cases
SET automated = 'yes'
WHERE app_type_id = 'a2'
   OR id IN ('tc_web_1_1', 'tc_web_2_1', 'tc_android_1_1', 'tc_ios_1_1', 'tc_unified_1_1');

UPDATE test_steps
SET step_type = CASE
  WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'api' THEN 'api'
  WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'android' THEN 'android'
  WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'ios' THEN 'ios'
  ELSE 'web'
END
FROM test_cases
JOIN app_types ON app_types.id = test_cases.app_type_id
WHERE test_steps.test_case_id = test_cases.id
  AND (test_steps.step_type IS NULL OR BTRIM(test_steps.step_type) = '');

INSERT INTO shared_step_groups (id, display_id, app_type_id, name, description, steps, created_by, updated_by)
VALUES (
  'sg1',
  'SG-1',
  'a1',
  'Reusable portal login',
  'Starter shared group for the main web portal authentication path.',
  '[
    {"step_order":1,"action":"Open web portal","expected_result":"Login page displayed","step_type":"web","automation_code":null,"api_request":null},
    {"step_order":2,"action":"Enter credentials","expected_result":"Credentials accepted","step_type":"web","automation_code":null,"api_request":null},
    {"step_order":3,"action":"Submit login","expected_result":"Dashboard loads successfully","step_type":"web","automation_code":null,"api_request":null}
  ]'::jsonb,
  'u1',
  'u1'
);

INSERT INTO test_environments (id, project_id, app_type_id, name, description, base_url, browser, notes, variables)
VALUES (
  'env_web_1',
  'p1',
  'a1',
  'QA Web Environment',
  'Primary QA environment for the SAP PM web portal.',
  'https://qa.sap-pm.example.com',
  'Chrome',
  'Seeded environment for scheduled runs and execution context.',
  '[
    {"key":"base_url","value":"https://qa.sap-pm.example.com"},
    {"key":"tenant","value":"QA"},
    {"key":"username","value":"technician.qa","is_secret":false}
  ]'::jsonb
);

INSERT INTO test_configurations (id, project_id, app_type_id, name, description, browser, mobile_os, platform_version, variables)
VALUES (
  'cfg_web_1',
  'p1',
  'a1',
  'Chrome Latest',
  'Standard desktop browser configuration for the QA portal.',
  'Chrome',
  NULL,
  NULL,
  '[
    {"key":"viewport","value":"1440x900"},
    {"key":"locale","value":"en-US"}
  ]'::jsonb
);

INSERT INTO test_data_sets (id, project_id, app_type_id, name, description, mode, columns, rows)
VALUES (
  'tds_web_1',
  'p1',
  'a1',
  'Portal Smoke Credentials',
  'Key smoke users and order identifiers for the QA portal.',
  'table',
  '["username","password","orderId"]'::jsonb,
  '[
    {"username":"technician.qa","password":"demo-pass","orderId":"PM-1001"},
    {"username":"planner.qa","password":"demo-pass","orderId":"PM-1002"}
  ]'::jsonb
);

UPDATE executions
SET
  test_environment_id = 'env_web_1',
  test_environment_name = 'QA Web Environment',
  test_environment_snapshot = '{
    "id":"env_web_1",
    "name":"QA Web Environment",
    "description":"Primary QA environment for the SAP PM web portal.",
    "base_url":"https://qa.sap-pm.example.com",
    "browser":"Chrome",
    "notes":"Seeded environment for scheduled runs and execution context.",
    "variables":[
      {"key":"base_url","value":"https://qa.sap-pm.example.com"},
      {"key":"tenant","value":"QA"},
      {"key":"username","value":"technician.qa","is_secret":false}
    ]
  }'::jsonb,
  test_configuration_id = 'cfg_web_1',
  test_configuration_name = 'Chrome Latest',
  test_configuration_snapshot = '{
    "id":"cfg_web_1",
    "name":"Chrome Latest",
    "description":"Standard desktop browser configuration for the QA portal.",
    "browser":"Chrome",
    "mobile_os":null,
    "platform_version":null,
    "variables":[
      {"key":"viewport","value":"1440x900"},
      {"key":"locale","value":"en-US"}
    ]
  }'::jsonb,
  test_data_set_id = 'tds_web_1',
  test_data_set_name = 'Portal Smoke Credentials',
  test_data_set_snapshot = '{
    "id":"tds_web_1",
    "name":"Portal Smoke Credentials",
    "description":"Key smoke users and order identifiers for the QA portal.",
    "mode":"table",
    "columns":["username","password","orderId"],
    "rows":[
      {"username":"technician.qa","password":"demo-pass","orderId":"PM-1001"},
      {"username":"planner.qa","password":"demo-pass","orderId":"PM-1002"}
    ]
  }'::jsonb,
  assigned_to = 'u2'
WHERE id = 'exec_web_3';

INSERT INTO execution_schedules (
  id,
  project_id,
  app_type_id,
  name,
  cadence,
  next_run_at,
  suite_ids,
  test_case_ids,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  assigned_to,
  created_by,
  is_active
)
VALUES (
  'sched1',
  'p1',
  'a1',
  'Weekly web smoke run',
  'weekly',
  CURRENT_TIMESTAMP + INTERVAL '2 days',
  '["ts_web_1","ts_web_2"]'::jsonb,
  '[]'::jsonb,
  'env_web_1',
  'cfg_web_1',
  'tds_web_1',
  'u2',
  'u1',
  TRUE
);

INSERT INTO ai_test_case_generation_jobs (
  id,
  project_id,
  app_type_id,
  integration_id,
  requirement_ids,
  max_cases_per_requirement,
  parallel_requirement_limit,
  additional_context,
  external_links,
  images,
  status,
  total_requirements,
  processed_requirements,
  generated_cases_count,
  error,
  created_by,
  created_at,
  started_at,
  completed_at,
  updated_at
)
VALUES (
  'aijob1',
  'p1',
  'a1',
  NULL,
  '["req1","req2"]'::jsonb,
  4,
  1,
  'Seeded example of scheduler-generated coverage for the main web smoke area.',
  '[]'::jsonb,
  '[]'::jsonb,
  'completed',
  2,
  2,
  2,
  NULL,
  'u1',
  CURRENT_TIMESTAMP - INTERVAL '7 days',
  CURRENT_TIMESTAMP - INTERVAL '7 days',
  CURRENT_TIMESTAMP - INTERVAL '7 days' + INTERVAL '12 minutes',
  CURRENT_TIMESTAMP - INTERVAL '7 days' + INTERVAL '12 minutes'
);

UPDATE test_cases
SET
  ai_generation_source = 'scheduler',
  ai_generation_review_status = 'accepted',
  ai_generation_job_id = 'aijob1',
  ai_generated_at = CURRENT_TIMESTAMP - INTERVAL '7 days',
  automated = 'yes'
WHERE id IN ('tc_web_1_2', 'tc_web_2_4');

INSERT INTO workspace_transactions (
  id,
  project_id,
  app_type_id,
  category,
  action,
  status,
  title,
  description,
  metadata,
  related_kind,
  related_id,
  created_by,
  started_at,
  completed_at,
  created_at,
  updated_at
)
VALUES (
  'wt1',
  'p1',
  'a1',
  'ai_generation',
  'scheduled_test_case_generation',
  'completed',
  'Scheduled AI test case generation',
  'Seeded operation showing accepted AI-generated coverage for web smoke scenarios.',
  '{
    "requirement_count":2,
    "processed_requirements":2,
    "generated_cases_count":2
  }'::jsonb,
  'ai_test_case_generation_job',
  'aijob1',
  'u1',
  CURRENT_TIMESTAMP - INTERVAL '7 days',
  CURRENT_TIMESTAMP - INTERVAL '7 days' + INTERVAL '12 minutes',
  CURRENT_TIMESTAMP - INTERVAL '7 days',
  CURRENT_TIMESTAMP - INTERVAL '7 days' + INTERVAL '12 minutes'
);

INSERT INTO workspace_transaction_events (id, transaction_id, level, phase, message, details, created_at)
VALUES
(
  'wte1',
  'wt1',
  'info',
  'run',
  'Processing 2 requirements with 1 worker.',
  '{"requirement_count":2,"worker_count":1}'::jsonb,
  CURRENT_TIMESTAMP - INTERVAL '7 days'
),
(
  'wte2',
  'wt1',
  'success',
  'complete',
  'Generated 2 AI test cases across 2 requirements.',
  '{"processed_requirements":2,"generated_cases_count":2}'::jsonb,
  CURRENT_TIMESTAMP - INTERVAL '7 days' + INTERVAL '12 minutes'
);
