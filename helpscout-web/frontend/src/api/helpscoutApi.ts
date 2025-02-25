import axios from 'axios';

const API_URL = 'http://localhost:3001/api';

// Types
export interface AuthResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
}

export interface Conversation {
    id: number;
    number: number;
    subject: string;
    status: string;
    createdAt: string;
    closedAt?: string;
    primaryCustomer: {
        id: number;
        first: string;
        email: string;
    };
    tags: Array<{
        id: number;
        tag: string;
    }>;
    _embedded: {
        threads: Array<{
            id: number;
            type: string;
            status: string;
            body: string;
            createdAt: string;
            createdBy: {
                id: number;
                type: string;
                first: string;
                email: string;
            };
        }>;
    };
}

export interface Tag {
    id: number;
    tag: string;
}

// API functions
export const authenticate = async (appId: string, appSecret: string): Promise<string> => {
    try {
        const response = await axios.post<AuthResponse>(`${API_URL}/auth`, { appId, appSecret });
        return response.data.access_token;
    } catch (error) {
        console.error('Authentication error:', error);
        throw new Error('Failed to authenticate with Help Scout');
    }
};

export const fetchConversations = async (
    token: string,
    from: string,
    to?: string,
    tags?: string[],
    status: string = 'all'
): Promise<Conversation[]> => {
    try {
        const params: any = { from, status };

        if (to) params.to = to;
        if (tags && tags.length > 0) params.tags = tags.join(',');

        const response = await axios.get(`${API_URL}/conversations`, {
            params,
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return response.data._embedded.conversations;
    } catch (error) {
        console.error('Error fetching conversations:', error);
        throw new Error('Failed to fetch conversations');
    }
};

export const fetchTags = async (token: string): Promise<Tag[]> => {
    try {
        const response = await axios.get(`${API_URL}/tags`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return response.data._embedded.tags;
    } catch (error) {
        console.error('Error fetching tags:', error);
        throw new Error('Failed to fetch tags');
    }
}; 
