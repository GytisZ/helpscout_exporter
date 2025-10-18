"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
const path_1 = __importDefault(require("path"));
const ws_1 = __importDefault(require("ws"));
const http_1 = __importDefault(require("http"));
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Create HTTP server and WebSocket server
const server = http_1.default.createServer(app);
const wss = new ws_1.default.Server({ server });
// Store active WebSocket connections
const clients = new Set();
// WebSocket connection handler
wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => {
        clients.delete(ws);
    });
});
// Helper function to broadcast progress updates
function broadcastProgress(message, data = {}) {
    const payload = JSON.stringify({
        type: 'progress',
        message,
        data,
        timestamp: new Date().toISOString()
    });
    clients.forEach(client => {
        if (client.readyState === ws_1.default.OPEN) {
            client.send(payload);
        }
    });
}
// Helper function to make API requests with rate limit handling
function makeRateLimitedRequest(url_1, token_1, params_1) {
    return __awaiter(this, arguments, void 0, function* (url, token, params, maxRetries = 3) {
        let retries = 0;
        while (retries <= maxRetries) {
            try {
                const response = yield axios_1.default.get(url, {
                    params,
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                // Log rate limit info if available
                const rateLimitRemaining = response.headers['x-ratelimit-remaining-minute'];
                const rateLimitLimit = response.headers['x-ratelimit-limit-minute'];
                if (rateLimitRemaining && rateLimitLimit) {
                    console.log(`Rate limit: ${rateLimitRemaining}/${rateLimitLimit} remaining`);
                }
                return response;
            }
            catch (error) {
                // Check if it's a rate limit error (429)
                if (error.response && error.response.status === 429) {
                    retries++;
                    // Get retry-after header (in seconds)
                    const retryAfter = parseInt(error.response.headers['x-ratelimit-retry-after'] || '60', 10);
                    if (retries <= maxRetries) {
                        const waitTime = retryAfter * 1000; // Convert to milliseconds
                        console.log(`Rate limit hit. Waiting ${retryAfter} seconds before retry ${retries}/${maxRetries}...`);
                        broadcastProgress(`Rate limit reached. Pausing for ${retryAfter} seconds...`, {
                            rateLimitPause: true,
                            retryAfter,
                            attempt: retries,
                            maxRetries
                        });
                        yield new Promise(resolve => setTimeout(resolve, waitTime));
                        continue; // Retry the request
                    }
                    else {
                        throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
                    }
                }
                // For other errors, throw immediately
                throw error;
            }
        }
        throw new Error('Max retries exceeded');
    });
}
// Authentication endpoint
app.post('/api/auth', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { appId, appSecret } = req.body;
        const response = yield axios_1.default.post('https://api.helpscout.net/v2/oauth2/token', new URLSearchParams({
            'grant_type': 'client_credentials',
            'client_id': appId,
            'client_secret': appSecret
        }).toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        res.json(response.data);
    }
    catch (error) {
        console.error('Authentication error:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        res.status(401).json({ error: 'Authentication failed' });
    }
}));
// Proxy endpoint for conversations
app.get('/api/conversations', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
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
            }
            else {
                // Open-ended query: (createdAt:[from TO *])
                query = `(createdAt:[${from}T00:00:00Z TO *])`;
            }
            params.query = query;
        }
        if (status)
            params.status = status;
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
            allConversations = yield fetchConversationsWithPagination(token, params, broadcastProgress);
        }
        else {
            // Fetch conversations for each tag and combine results
            console.log(`Fetching conversations for ${tagList.length} tags: ${tagList.join(', ')}`);
            broadcastProgress('Fetching tags information...');
            // First, get all tags to map slugs to display names
            const tagsResponse = yield makeRateLimitedRequest('https://api.helpscout.net/v2/tags', token);
            const allTagsData = ((_b = tagsResponse.data._embedded) === null || _b === void 0 ? void 0 : _b.tags) || [];
            const tagMap = new Map();
            // Create a map of slug to display name
            allTagsData.forEach((tag) => {
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
                const tagParams = Object.assign(Object.assign({}, params), { tag: tagName });
                const tagConversations = yield fetchConversationsWithPagination(token, tagParams, broadcastProgress);
                // Add conversations from this tag, avoiding duplicates
                let newCount = 0;
                for (const conv of tagConversations) {
                    if (!allConversations.some(c => c.id === conv.id)) {
                        allConversations.push(conv);
                        newCount++;
                    }
                }
                broadcastProgress(`Added ${newCount} unique conversations from tag: ${tagName}`, { total: allConversations.length });
            }
        }
        // For each conversation, fetch threads if needed
        if (allConversations.length > 0) {
            console.log(`Fetching threads for ${allConversations.length} conversations...`);
            broadcastProgress('Fetching conversation threads...', {
                total: allConversations.length,
                progress: 0
            });
            // Fetch threads in parallel batches for better performance
            const BATCH_SIZE = 10; // Process 10 conversations at a time
            let completed = 0;
            console.log(`🚀 USING PARALLEL BATCH PROCESSING: ${allConversations.length} conversations in batches of ${BATCH_SIZE}`);
            broadcastProgress(`Using parallel batch processing (${BATCH_SIZE} at a time)`, {
                batchSize: BATCH_SIZE,
                totalConversations: allConversations.length
            });
            for (let i = 0; i < allConversations.length; i += BATCH_SIZE) {
                const batch = allConversations.slice(i, i + BATCH_SIZE);
                const batchNum = Math.floor(i / BATCH_SIZE) + 1;
                const totalBatches = Math.ceil(allConversations.length / BATCH_SIZE);
                console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} conversations in parallel)`);
                // Fetch all threads in this batch in parallel
                yield Promise.all(batch.map((conversation) => __awaiter(void 0, void 0, void 0, function* () {
                    try {
                        // Fetch threads for this conversation with rate limit handling
                        const threadsResponse = yield makeRateLimitedRequest(`https://api.helpscout.net/v2/conversations/${conversation.id}/threads`, token);
                        // Add threads to the conversation
                        if (threadsResponse.data._embedded && Array.isArray(threadsResponse.data._embedded.threads)) {
                            conversation._embedded = {
                                threads: threadsResponse.data._embedded.threads
                            };
                        }
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        console.error(`Error fetching threads for conversation ${conversation.id}:`, errorMessage);
                        // Continue with the next conversation even if this one fails
                    }
                })));
                completed += batch.length;
                const progress = Math.round((completed / allConversations.length) * 100);
                console.log(`Fetched threads for ${completed}/${allConversations.length} conversations (${progress}%)`);
                broadcastProgress(`Fetching threads: ${completed}/${allConversations.length}`, {
                    progress,
                    current: completed,
                    total: allConversations.length
                });
            }
            broadcastProgress('Finished fetching threads', {
                complete: true,
                progress: 100
            });
        }
        console.log(`Returning ${allConversations.length} conversations`);
        broadcastProgress(`Export complete! ${allConversations.length} conversations exported.`, { complete: true, total: allConversations.length });
        res.json({
            _embedded: {
                conversations: allConversations
            }
        });
    }
    catch (error) {
        console.error('API error:', ((_c = error.response) === null || _c === void 0 ? void 0 : _c.data) || error.message);
        broadcastProgress('Error during export', { error: error.message });
        res.status(((_d = error.response) === null || _d === void 0 ? void 0 : _d.status) || 500).json({
            error: ((_e = error.response) === null || _e === void 0 ? void 0 : _e.data) || 'Failed to fetch conversations'
        });
    }
}));
// Helper function to fetch conversations with pagination
function fetchConversationsWithPagination(token, params, progressCallback) {
    return __awaiter(this, void 0, void 0, function* () {
        let allConversations = [];
        let page = 1;
        let hasMorePages = true;
        let totalPages = 1;
        while (hasMorePages) {
            const pageParams = Object.assign(Object.assign({}, params), { page });
            try {
                // Log the exact request parameters for debugging
                console.log('Fetching conversations with params:', JSON.stringify(pageParams));
                if (progressCallback) {
                    progressCallback(`Fetching page ${page}${totalPages > 1 ? '/' + totalPages : ''}...`);
                }
                const response = yield makeRateLimitedRequest('https://api.helpscout.net/v2/conversations', token, pageParams);
                // Add conversations from this page
                if (response.data._embedded && Array.isArray(response.data._embedded.conversations)) {
                    allConversations = [...allConversations, ...response.data._embedded.conversations];
                }
                // Check if there are more pages
                const pageInfo = response.data.page;
                totalPages = (pageInfo === null || pageInfo === void 0 ? void 0 : pageInfo.totalPages) || 1;
                hasMorePages = pageInfo && pageInfo.number < pageInfo.totalPages;
                // Log progress
                console.log(`Fetched page ${page}/${(pageInfo === null || pageInfo === void 0 ? void 0 : pageInfo.totalPages) || 1} of conversations. Total so far: ${allConversations.length}`);
                if (progressCallback) {
                    progressCallback(`Fetched page ${page}/${(pageInfo === null || pageInfo === void 0 ? void 0 : pageInfo.totalPages) || 1}`, {
                        page,
                        totalPages: (pageInfo === null || pageInfo === void 0 ? void 0 : pageInfo.totalPages) || 1,
                        conversationsCount: allConversations.length,
                        progress: Math.round((page / ((pageInfo === null || pageInfo === void 0 ? void 0 : pageInfo.totalPages) || 1)) * 100)
                    });
                }
                page++;
            }
            catch (error) {
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
    });
}
// Get tags endpoint
app.get('/api/tags', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const response = yield makeRateLimitedRequest('https://api.helpscout.net/v2/tags', token);
        res.json(response.data);
    }
    catch (error) {
        console.error('API error:', ((_b = error.response) === null || _b === void 0 ? void 0 : _b.data) || error.message);
        res.status(((_c = error.response) === null || _c === void 0 ? void 0 : _c.status) || 500).json({
            error: ((_d = error.response) === null || _d === void 0 ? void 0 : _d.data) || 'Failed to fetch tags'
        });
    }
}));
// Add this endpoint to get conversation count for a tag
app.get('/api/conversation-count', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
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
        const response = yield makeRateLimitedRequest('https://api.helpscout.net/v2/conversations', token, params);
        // Get the total count from the response
        const count = ((_b = response.data.page) === null || _b === void 0 ? void 0 : _b.totalElements) || 0;
        res.json({ count });
    }
    catch (error) {
        console.error('API error:', ((_c = error.response) === null || _c === void 0 ? void 0 : _c.data) || error.message);
        res.status(((_d = error.response) === null || _d === void 0 ? void 0 : _d.status) || 500).json({
            error: ((_e = error.response) === null || _e === void 0 ? void 0 : _e.data) || 'Failed to fetch conversation count'
        });
    }
}));
// Simplify the tags-with-counts endpoint to use the ticketCount property directly
app.get('/api/tags-with-counts', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
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
            const response = yield makeRateLimitedRequest('https://api.helpscout.net/v2/tags', token, { page: page });
            // Check if we have valid data
            if (!response.data._embedded || !Array.isArray(response.data._embedded.tags)) {
                console.error('Unexpected response format:', response.data);
                break;
            }
            // Add tags from this page to our collection
            const pageTags = response.data._embedded.tags;
            console.log(`Received ${pageTags.length} tags on page ${page}`);
            // Process tags to include count from ticketCount property
            const processedTags = pageTags.map((tag) => ({
                id: tag.id,
                name: tag.name,
                slug: tag.slug,
                color: tag.color,
                count: tag.ticketCount || 0
            }));
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
    }
    catch (error) {
        console.error('API error:', ((_b = error.response) === null || _b === void 0 ? void 0 : _b.data) || error.message);
        res.status(((_c = error.response) === null || _c === void 0 ? void 0 : _c.status) || 500).json({
            error: ((_d = error.response) === null || _d === void 0 ? void 0 : _d.data) || 'Failed to fetch tags with counts'
        });
    }
}));
// Update the count-conversations endpoint to use the correct date filter format
app.get('/api/count-conversations', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
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
            }
            else {
                // Open-ended query: (createdAt:[from TO *])
                query = `(createdAt:[${from}T00:00:00Z TO *])`;
            }
            params.query = query;
        }
        if (status)
            params.status = status;
        console.log('Count request with params:', { from, to, tags, status });
        console.log('Using query:', params.query);
        // Handle tags parameter - Help Scout API only accepts one tag at a time
        const tagList = tags ? String(tags).split(',') : [];
        let totalCount = 0;
        if (tagList.length === 0) {
            // No tags specified, count all conversations matching other criteria
            const response = yield makeRateLimitedRequest('https://api.helpscout.net/v2/conversations', token, Object.assign(Object.assign({}, params), { page: 1 }));
            totalCount = ((_b = response.data.page) === null || _b === void 0 ? void 0 : _b.totalElements) || 0;
        }
        else {
            // Count conversations for each tag
            console.log(`Counting conversations for ${tagList.length} tags: ${tagList.join(', ')}`);
            // First, get all tags to map slugs to display names
            const tagsResponse = yield makeRateLimitedRequest('https://api.helpscout.net/v2/tags', token);
            const allTagsData = ((_c = tagsResponse.data._embedded) === null || _c === void 0 ? void 0 : _c.tags) || [];
            const tagMap = new Map();
            // Create a map of slug to display name
            allTagsData.forEach((tag) => {
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
                const tagParams = Object.assign(Object.assign({}, params), { tag: tagName });
                const response = yield makeRateLimitedRequest('https://api.helpscout.net/v2/conversations', token, Object.assign(Object.assign({}, tagParams), { page: 1 }));
                const tagCount = ((_d = response.data.page) === null || _d === void 0 ? void 0 : _d.totalElements) || 0;
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
    }
    catch (error) {
        console.error('API error:', ((_e = error.response) === null || _e === void 0 ? void 0 : _e.data) || error.message);
        res.status(((_f = error.response) === null || _f === void 0 ? void 0 : _f.status) || 500).json({
            error: ((_g = error.response) === null || _g === void 0 ? void 0 : _g.data) || 'Failed to count conversations'
        });
    }
}));
// In production, serve the frontend files
if (isProduction) {
    // Serve static files from the React frontend
    app.use(express_1.default.static(path_1.default.join(__dirname, '../../frontend/dist')));
    // Handle any requests that don't match the API routes
    app.get('*', (req, res) => {
        res.sendFile(path_1.default.join(__dirname, '../../frontend/dist/index.html'));
    });
}
// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
