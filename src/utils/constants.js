/**
 * Utilitaires et Constantes - src/utils/constants.js
 * Centralise les chaînes de caractères pour prévenir les hardcodings.
 */

export const STORAGE_KEYS = {
    // Sync Storage (Config)
    PROFILES: 'doliProfiles',
    ACTIVE_PROFILE_ID: 'doliActiveProfileId',
    DEFAULT_VIEW: 'doliDefaultView',
    RECENT_COUNT: 'doliRecentCount',

    // Local Storage (Cache & Drafts)
    DRAFT_OPPORTUNITY: 'draftOppKey',
    DRAFT_TICKET: 'draftTicketKey',
    DRAFT_SHARED: 'draftSharedKey'
};

export const MESSAGE_TYPES = {
    API_CALL: 'API_CALL',
    OPEN_POPUP: 'OPEN_EXTENSION_POPUP',
    OPEN_OPTIONS: 'OPEN_OPTIONS_PAGE'
};

export const API_ENDPOINTS = {
    USERS: '/users',
    THIRDPARTIES: '/thirdparties',
    CONTACTS: '/contacts',
    PROJECTS: '/projects',
    TICKETS: '/tickets',
    SETUP_DICTIONARY: '/setup/dictionary',
    SETUP_EXTRAFIELDS: '/setup/extrafields',
    SETUP_COMPANY: '/setup/company',
    DOCUMENTS_DOWNLOAD: '/documents/download',
    DOCUMENTS_UPLOAD: '/documents/upload',
    STATUS: '/status'
};
