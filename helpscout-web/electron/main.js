const { app, BrowserWindow, Menu, dialog, clipboard, MenuItem, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const WebSocket = require('ws');

// We'll initialize this later
let store;

// Initialize store asynchronously
async function initializeStore() {
    const Store = await import('electron-store');
    store = new Store.default({
        encryptionKey: 'helpscout-web-encryption-key',
        schema: {
            credentials: {
                type: 'object',
                properties: {
                    appId: { type: 'string' },
                    appSecret: { type: 'string' }
                }
            }
        }
    });

    // Now that store is initialized, we can create the window
    createWindow();
}

let mainWindow;
let server;
const PORT = 3001;

// Create WebSocket server
let wss;

// Store active WebSocket connections
const clients = new Set();

// Helper function to broadcast progress updates
function broadcastProgress(message, data = {}) {
    const payload = JSON.stringify({
        type: 'progress',
        message,
        data,
        timestamp: new Date().toISOString()
    });

    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// Create the browser window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            spellcheck: true,
            sandbox: false,
            enableWebSQL: false
        },
        icon: path.join(__dirname, 'icon.png')
    });

    // Show loading screen
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));

    // Start backend server
    startBackend();

    // Create menu
    const menu = Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                {
                    label: 'Exit',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Developer Tools',
                    accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About Help Scout Exporter',
                            message: 'Help Scout Exporter v1.0.0',
                            detail: 'A tool for exporting and analyzing Help Scout conversations.'
                        });
                    }
                }
            ]
        }
    ]);
    Menu.setApplicationMenu(menu);

    // When closed
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Enable context menu with paste
    mainWindow.webContents.on('context-menu', (_, params) => {
        const menu = new Menu();

        // Add each type of functionality
        for (const type of ['cut', 'copy', 'paste']) {
            menu.append(new MenuItem({
                label: type[0].toUpperCase() + type.slice(1),
                role: type,
                accelerator: `CmdOrCtrl+${type[0].toUpperCase()}`
            }));
        }

        menu.popup();
    });

    // Set up IPC handlers for credential storage
    setupIpcHandlers();
}

// Set up IPC handlers for communication with the renderer process
function setupIpcHandlers() {
    // Save credentials
    ipcMain.handle('save-credentials', async (event, { appId, appSecret }) => {
        store.set('credentials', { appId, appSecret });
        return true;
    });

    // Get credentials
    ipcMain.handle('get-credentials', async () => {
        return store.get('credentials') || { appId: '', appSecret: '' };
    });

    // Clear credentials
    ipcMain.handle('clear-credentials', async () => {
        store.delete('credentials');
        return true;
    });
}

// Start the backend server directly in the Electron process
function startBackend() {
    console.log('Starting backend server...');

    const expressApp = express();

    // Middleware
    expressApp.use(cors());
    expressApp.use(express.json());

    // Authentication endpoint
    expressApp.post('/api/auth', async (req, res) => {
        try {
            const { appId, appSecret } = req.body;

            const response = await axios.post('https://api.helpscout.net/v2/oauth2/token',
                new URLSearchParams({
                    'grant_type': 'client_credentials',
                    'client_id': appId,
                    'client_secret': appSecret
                }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            res.json(response.data);
        } catch (error) {
            console.error('Authentication error:', error.response?.data || error.message);
            res.status(401).json({ error: 'Authentication failed' });
        }
    });

    // Proxy endpoint for conversations
    expressApp.get('/api/conversations', async (req, res) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                return res.status(401).json({ error: 'No token provided' });
            }

            const { from, to, tags, status } = req.query;

            // Build query parameters - use query parameter with proper date format
            const params = {};

            // Build the date query using the format from main.py
            if (from) {
                let query = '';

                if (to) {
                    // Date range query: (createdAt:[from TO to])
                    query = `(createdAt:[${from}T00:00:00Z TO ${to}T23:59:59Z])`;
                } else {
                    // Open-ended query: (createdAt:[from TO *])
                    query = `(createdAt:[${from}T00:00:00Z TO *])`;
                }

                params.query = query;
            }

            if (status) params.status = status;

            // Initialize result array and pagination variables
            let allConversations = [];

            console.log('Export request with params:', { from, to, tags, status });
            console.log('Using query:', params.query);
            broadcastProgress('Starting export...', { params: { from, to, tags, status } });

            // Handle tags parameter - Help Scout API only accepts one tag at a time
            // If multiple tags are selected, we need to make separate requests and combine results
            const tagList = tags ? String(tags).split(',') : [];

            if (tagList.length === 0) {
                // No tags specified, fetch all conversations matching other criteria
                broadcastProgress('Fetching conversations...');
                allConversations = await fetchConversationsWithPagination(token, params, broadcastProgress);
            } else {
                // Fetch conversations for each tag and combine results
                console.log(`Fetching conversations for ${tagList.length} tags: ${tagList.join(', ')}`);
                broadcastProgress('Fetching tags information...');

                // First, get all tags to map slugs to display names
                const tagsResponse = await axios.get('https://api.helpscout.net/v2/tags', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const allTagsData = tagsResponse.data._embedded?.tags || [];
                const tagMap = new Map();

                // Create a map of slug to display name
                allTagsData.forEach(tag => {
                    tagMap.set(tag.slug, tag.name);
                });

                let tagIndex = 0;
                for (const tagSlug of tagList) {
                    tagIndex++;
                    // Get the display name for this tag slug
                    const tagName = tagMap.get(tagSlug);

                    if (!tagName) {
                        console.warn(`Could not find display name for tag slug: ${tagSlug}`);
                        broadcastProgress(`Warning: Could not find display name for tag: ${tagSlug}`);
                        continue;
                    }

                    console.log(`Fetching conversations for tag: ${tagSlug} (display name: ${tagName})`);
                    broadcastProgress(`Fetching conversations for tag ${tagIndex}/${tagList.length}: ${tagName}`);

                    const tagParams = { ...params, tag: tagName };
                    const tagConversations = await fetchConversationsWithPagination(token, tagParams, broadcastProgress);

                    // Add conversations from this tag, avoiding duplicates
                    let newCount = 0;
                    for (const conv of tagConversations) {
                        if (!allConversations.some(c => c.id === conv.id)) {
                            allConversations.push(conv);
                            newCount++;
                        }
                    }

                    broadcastProgress(`Added ${newCount} unique conversations from tag: ${tagName}`,
                        { total: allConversations.length });
                }
            }

            // For each conversation, fetch threads if needed
            if (allConversations.length > 0) {
                console.log(`Fetching threads for ${allConversations.length} conversations...`);
                broadcastProgress('Fetching conversation threads...', {
                    total: allConversations.length,
                    progress: 0
                });

                for (let i = 0; i < allConversations.length; i++) {
                    const conversation = allConversations[i];

                    try {
                        // Log progress periodically
                        if (i % 10 === 0 || i === allConversations.length - 1) {
                            const progress = Math.round((i / allConversations.length) * 100);
                            console.log(`Fetching threads for conversation ${i + 1}/${allConversations.length} (${progress}%)`);
                            broadcastProgress(`Fetching threads for conversation ${i + 1}/${allConversations.length}`, {
                                progress,
                                current: i + 1,
                                total: allConversations.length
                            });
                        }

                        // Fetch threads for this conversation
                        const threadsResponse = await axios.get(`https://api.helpscout.net/v2/conversations/${conversation.id}/threads`, {
                            headers: {
                                'Authorization': `Bearer ${token}`
                            }
                        });

                        // Add threads to the conversation
                        if (threadsResponse.data._embedded && Array.isArray(threadsResponse.data._embedded.threads)) {
                            conversation._embedded = {
                                threads: threadsResponse.data._embedded.threads
                            };
                        }
                    } catch (error) {
                        console.error(`Error fetching threads for conversation ${conversation.id}:`, error.message);
                        // Continue with the next conversation even if this one fails
                    }
                }

                broadcastProgress('Finished fetching threads', {
                    complete: true,
                    progress: 100
                });
            }

            console.log(`Returning ${allConversations.length} conversations`);
            broadcastProgress(`Export complete! ${allConversations.length} conversations exported.`,
                { complete: true, total: allConversations.length });

            res.json({
                _embedded: {
                    conversations: allConversations
                }
            });
        } catch (error) {
            console.error('API error:', error.response?.data || error.message);
            broadcastProgress('Error during export', { error: error.message });
            res.status(error.response?.status || 500).json({
                error: error.response?.data || 'Failed to fetch conversations'
            });
        }
    });

    // Get tags endpoint
    expressApp.get('/api/tags', async (req, res) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                return res.status(401).json({ error: 'No token provided' });
            }

            const response = await axios.get('https://api.helpscout.net/v2/tags', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            res.json(response.data);
        } catch (error) {
            console.error('API error:', error.response?.data || error.message);
            res.status(error.response?.status || 500).json({
                error: error.response?.data || 'Failed to fetch tags'
            });
        }
    });

    // Add a new endpoint to get stored credentials
    expressApp.get('/api/stored-credentials', (req, res) => {
        const credentials = store.get('credentials') || { appId: '', appSecret: '' };
        res.json(credentials);
    });

    // Add an endpoint to save credentials
    expressApp.post('/api/store-credentials', (req, res) => {
        const { appId, appSecret, remember } = req.body;

        if (remember) {
            store.set('credentials', { appId, appSecret });
        } else {
            store.delete('credentials');
        }

        res.json({ success: true });
    });

    // Add this endpoint to get conversation count for a tag
    expressApp.get('/api/conversation-count', async (req, res) => {
        try {
            console.log('Fetching conversation count for tag:', req.query.tags);

            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                return res.status(401).json({ error: 'No token provided' });
            }

            const { tags } = req.query;
            if (!tags) {
                return res.status(400).json({ error: 'Tag parameter is required' });
            }

            const params = {
                tag: tags,
                status: 'all'
            };

            console.log('Request params:', params);

            const response = await axios.get('https://api.helpscout.net/v2/conversations', {
                params,
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            // Get the total count from the response
            const count = response.data.page?.totalElements || 0;
            console.log(`Count for tag ${tags}:`, count);

            res.json({ count });
        } catch (error) {
            console.error('API error:', error.response?.data || error.message);
            res.status(error.response?.status || 500).json({
                error: error.response?.data || 'Failed to fetch conversation count'
            });
        }
    });

    // Simplify the tags-with-counts endpoint to use the ticketCount property directly
    expressApp.get('/api/tags-with-counts', async (req, res) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                return res.status(401).json({ error: 'No token provided' });
            }

            // Initialize variables for pagination
            let allTags = [];
            let page = 1;
            let hasMorePages = true;

            console.log('Fetching tags with pagination...');

            // Fetch all pages of tags
            while (hasMorePages) {
                console.log(`Fetching tags page ${page}...`);

                const response = await axios.get('https://api.helpscout.net/v2/tags', {
                    params: {
                        page: page
                    },
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                // Check if we have valid data
                if (!response.data._embedded || !Array.isArray(response.data._embedded.tags)) {
                    console.error('Unexpected response format:', response.data);
                    break;
                }

                // Add tags from this page to our collection
                const pageTags = response.data._embedded.tags;
                console.log(`Received ${pageTags.length} tags on page ${page}`);

                // Process tags to include count from ticketCount property
                const processedTags = pageTags.map(tag => {
                    console.log(`Tag ${tag.name} has ticketCount: ${tag.ticketCount}`);
                    return {
                        id: tag.id,
                        name: tag.name,
                        slug: tag.slug,
                        color: tag.color,
                        count: tag.ticketCount || 0
                    };
                });

                allTags = [...allTags, ...processedTags];

                // Check if there are more pages
                const pageInfo = response.data.page;
                hasMorePages = pageInfo && pageInfo.number < pageInfo.totalPages;

                page++;
            }

            console.log(`Fetched a total of ${allTags.length} tags with counts`);

            // Sort tags by count (descending)
            allTags.sort((a, b) => b.count - a.count);

            res.json({
                _embedded: {
                    tags: allTags
                }
            });
        } catch (error) {
            console.error('API error:', error.response?.data || error.message);
            res.status(error.response?.status || 500).json({
                error: error.response?.data || 'Failed to fetch tags with counts'
            });
        }
    });

    // Add a new endpoint to count conversations
    expressApp.get('/api/count-conversations', async (req, res) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                return res.status(401).json({ error: 'No token provided' });
            }

            const { from, to, tags, status } = req.query;

            // Build query parameters - use query parameter with proper date format
            const params = {};

            // Build the date query using the format from main.py
            if (from) {
                let query = '';

                if (to) {
                    // Date range query: (createdAt:[from TO to])
                    query = `(createdAt:[${from}T00:00:00Z TO ${to}T23:59:59Z])`;
                } else {
                    // Open-ended query: (createdAt:[from TO *])
                    query = `(createdAt:[${from}T00:00:00Z TO *])`;
                }

                params.query = query;
            }

            if (status) params.status = status;

            console.log('Count request with params:', { from, to, tags, status });
            console.log('Using query:', params.query);

            // Handle tags parameter - Help Scout API only accepts one tag at a time
            const tagList = tags ? String(tags).split(',') : [];
            let totalCount = 0;

            if (tagList.length === 0) {
                // No tags specified, count all conversations matching other criteria
                const response = await axios.get('https://api.helpscout.net/v2/conversations', {
                    params: { ...params, page: 1 },
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                totalCount = response.data.page?.totalElements || 0;
            } else {
                // Count conversations for each tag
                console.log(`Counting conversations for ${tagList.length} tags: ${tagList.join(', ')}`);

                // First, get all tags to map slugs to display names
                const tagsResponse = await axios.get('https://api.helpscout.net/v2/tags', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const allTagsData = tagsResponse.data._embedded?.tags || [];
                const tagMap = new Map();

                // Create a map of slug to display name
                allTagsData.forEach(tag => {
                    tagMap.set(tag.slug, tag.name);
                });

                // Set to track unique conversation IDs
                const uniqueIds = new Set();

                for (const tagSlug of tagList) {
                    // Get the display name for this tag slug
                    const tagName = tagMap.get(tagSlug);

                    if (!tagName) {
                        console.warn(`Could not find display name for tag slug: ${tagSlug}`);
                        continue;
                    }

                    console.log(`Counting conversations for tag: ${tagSlug} (display name: ${tagName})`);

                    const tagParams = { ...params, tag: tagName };
                    const response = await axios.get('https://api.helpscout.net/v2/conversations', {
                        params: { ...tagParams, page: 1 },
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    const tagCount = response.data.page?.totalElements || 0;
                    console.log(`Tag ${tagName} has ${tagCount} conversations`);

                    // For accurate counts with multiple tags, we'd need to fetch all conversations
                    // and count unique IDs, but that would defeat the purpose of this endpoint.
                    // Instead, we'll just sum the counts and note that it might include duplicates.
                    totalCount += tagCount;
                }

                // Note: This count might include duplicates if conversations have multiple tags
                console.log(`Total count across all tags: ${totalCount} (may include duplicates)`);
            }

            res.json({ count: totalCount });
        } catch (error) {
            console.error('API error:', error.response?.data || error.message);
            res.status(error.response?.status || 500).json({
                error: error.response?.data || 'Failed to count conversations'
            });
        }
    });

    // Serve static files from the frontend build
    expressApp.use(express.static(path.join(__dirname, 'frontend')));

    // Handle any requests that don't match the API routes
    expressApp.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
    });

    // Start the server
    server = expressApp.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        // Load the frontend once backend is ready
        mainWindow.loadURL(`http://localhost:${PORT}`);
    });

    // Initialize WebSocket server
    wss = new WebSocket.Server({ server });

    // WebSocket connection handler
    wss.on('connection', (ws) => {
        clients.add(ws);

        ws.on('close', () => {
            clients.delete(ws);
        });
    });
}

// Update the fetchConversationsWithPagination function to send progress updates
async function fetchConversationsWithPagination(token, params, progressCallback) {
    let allConversations = [];
    let page = 1;
    let hasMorePages = true;
    let totalPages = 1;

    while (hasMorePages) {
        const pageParams = { ...params, page };

        try {
            // Log the exact request parameters for debugging
            console.log('Fetching conversations with params:', JSON.stringify(pageParams));

            if (progressCallback) {
                progressCallback(`Fetching page ${page}${totalPages > 1 ? '/' + totalPages : ''}...`);
            }

            const response = await axios.get('https://api.helpscout.net/v2/conversations', {
                params: pageParams,
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            // Add conversations from this page
            if (response.data._embedded && Array.isArray(response.data._embedded.conversations)) {
                allConversations = [...allConversations, ...response.data._embedded.conversations];
            }

            // Check if there are more pages
            const pageInfo = response.data.page;
            totalPages = pageInfo?.totalPages || 1;
            hasMorePages = pageInfo && pageInfo.number < pageInfo.totalPages;

            // Log progress
            console.log(`Fetched page ${page}/${pageInfo?.totalPages || 1} of conversations. Total so far: ${allConversations.length}`);

            if (progressCallback) {
                progressCallback(`Fetched page ${page}/${pageInfo?.totalPages || 1}`, {
                    page,
                    totalPages: pageInfo?.totalPages || 1,
                    conversationsCount: allConversations.length,
                    progress: Math.round((page / (pageInfo?.totalPages || 1)) * 100)
                });
            }

            page++;
        } catch (error) {
            console.error(`Error fetching page ${page} of conversations:`, error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
            }
            if (progressCallback) {
                progressCallback(`Error fetching page ${page}: ${error.message}`);
            }
            hasMorePages = false;
        }
    }

    return allConversations;
}

// When Electron is ready
app.whenReady().then(initializeStore);

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Clean up server when quitting
app.on('quit', () => {
    if (server) {
        console.log('Closing server...');
        server.close();
    }
    if (wss) {
        console.log('Closing WebSocket server...');
        wss.close();
    }
}); 
