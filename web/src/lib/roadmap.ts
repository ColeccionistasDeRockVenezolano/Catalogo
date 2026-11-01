// CRV · Cliente del roadmap y las visitas (Fase 2).
import { request } from "./api";

export type TaskStatus = "pending" | "in_progress" | "completed";
export type Lang = "es" | "en";

export interface Progress { total: number; completed: number; percentage: number }
export interface PublicTask {
  id: number; title: string; status: TaskStatus; completedAt: string | null; updatedAt: string;
}
export interface PublicCategory {
  id: number; slug: string; title: string; colorKey: string; progress: Progress; tasks: PublicTask[];
}
export interface PublicRoadmap {
  visibility: string; overall: Progress; categories: PublicCategory[]; lastUpdated: string | null;
  collaborators: number;
}
export interface CountryCount { code: string; flag?: string | null; name: string; count: number }
export interface VisitStats {
  today: number; total: number; online: number;
  todayCountries: CountryCount[]; onlineCountries: CountryCount[]; totalCountries: CountryCount[];
}
export interface AssignedUser { id: number; name: string; displayName: string }
export interface AdminTask {
  id: number; categoryId: number; title: string; status: TaskStatus; sortOrder: number;
  orderPinned: boolean; completedAt: string | null; updatedAt: string;
  i18n: { en?: string }; assignedUsers: AssignedUser[];
}
export interface AdminCategory {
  id: number; slug: string; title: string; colorKey: string;
  i18n: { en?: string }; progress: Progress; tasks: AdminTask[];
}
export interface AdminRoadmap {
  visibility: string; overall: Progress; categories: AdminCategory[];
  lastUpdated: string | null; users: AssignedUser[];
}
export interface AdminVisits extends VisitStats {
  days: number;
  daily: Array<{ day: string; visits: number; requests: number; visitors: number; uniqueVisitors: number }>;
  pages: Array<{ page: string; category: string; requests: number; visitors: number }>;
  agents: Array<{ agent: string; requests: number }>;
  trafficRequests: number;
}

const json = (method: "POST" | "PATCH", body: unknown, authenticated = true) =>
  ({ method, body, authenticated });

export const roadmapApi = {
  public: (lang: Lang) => request<PublicRoadmap>("/roadmap", { query: { lang } }),
  visits: (lang: Lang) => request<VisitStats>("/roadmap/visits", { query: { lang } }),
  visit: () => request<VisitStats>("/roadmap/visit", { method: "POST" }),

  admin: () => request<AdminRoadmap>("/community/admin/roadmap"),
  createCategory: (body: { title: string; translations?: { en?: string } }) =>
    request<{ roadmap: AdminRoadmap }>("/community/admin/roadmap/categories", json("POST", body)),
  updateCategory: (id: number, body: { title?: string; position?: number; translations?: { en?: string } }) =>
    request<{ roadmap: AdminRoadmap }>(`/community/admin/roadmap/categories/${id}`, json("PATCH", body)),
  deleteCategory: (id: number, force = false) =>
    request<void>(`/community/admin/roadmap/categories/${id}`, { method: "DELETE", authenticated: true, query: { force: String(force) } }),
  createTask: (body: {
    categoryId: number; title: string; status: TaskStatus; position?: number;
    assignedUserIds?: number[]; translations?: { en?: string };
  }) => request<{ roadmap: AdminRoadmap }>("/community/admin/roadmap/tasks", json("POST", body)),
  updateTask: (id: number, body: {
    title?: string; status?: TaskStatus; categoryId?: number; position?: number;
    assignedUserIds?: number[]; pinned?: boolean; translations?: { en?: string };
  }) => request<{ roadmap: AdminRoadmap }>(`/community/admin/roadmap/tasks/${id}`, json("PATCH", body)),
  deleteTask: (id: number) => request<void>(`/community/admin/roadmap/tasks/${id}`, { method: "DELETE", authenticated: true }),
  moveTask: (id: number, direction: "up" | "down") =>
    request<{ roadmap: AdminRoadmap }>(`/community/admin/roadmap/tasks/${id}/move`, json("POST", { direction })),
  moveTaskToCategory: (id: number, categoryId: number) =>
    request<{ roadmap: AdminRoadmap }>(`/community/admin/roadmap/tasks/${id}/category`, json("POST", { categoryId })),
  adminVisits: (days = 30, lang: Lang = "es") =>
    request<AdminVisits>("/community/admin/visits", { query: { days, lang } }),
};
