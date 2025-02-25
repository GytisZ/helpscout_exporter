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
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
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
    var _a, _b, _c, _d;
    try {
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const { from, to, tags, status } = req.query;
        // Build query parameters
        let createdQuery = '';
        if (from) {
            const fromDate = new Date(from);
            const fromStr = fromDate.toISOString().split('T')[0] + 'T00:00:00Z';
            if (to) {
                const toDate = new Date(to);
                const toStr = toDate.toISOString().split('T')[0] + 'T00:00:00Z';
                createdQuery = `(createdAt:[${fromStr} TO ${toStr}])`;
            }
            else {
                createdQuery = `(createdAt:[${fromStr} TO *])`;
            }
        }
        const params = {
            status: status || 'all',
            embed: 'threads',
            query: createdQuery
        };
        if (tags) {
            params.tag = tags;
        }
        const response = yield axios_1.default.get('https://api.helpscout.net/v2/conversations', {
            params,
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        res.json(response.data);
    }
    catch (error) {
        console.error('API error:', ((_b = error.response) === null || _b === void 0 ? void 0 : _b.data) || error.message);
        res.status(((_c = error.response) === null || _c === void 0 ? void 0 : _c.status) || 500).json({
            error: ((_d = error.response) === null || _d === void 0 ? void 0 : _d.data) || 'Failed to fetch conversations'
        });
    }
}));
// Get tags endpoint
app.get('/api/tags', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const response = yield axios_1.default.get('https://api.helpscout.net/v2/tags', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        res.json(response.data);
    }
    catch (error) {
        console.error('API error:', ((_b = error.response) === null || _b === void 0 ? void 0 : _b.data) || error.message);
        res.status(((_c = error.response) === null || _c === void 0 ? void 0 : _c.status) || 500).json({
            error: ((_d = error.response) === null || _d === void 0 ? void 0 : _d.data) || 'Failed to fetch tags'
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
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
