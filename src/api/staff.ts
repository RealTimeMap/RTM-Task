import { request } from './client'
import type { Staff, StaffListResponse, StaffRole } from '../types/staff'

export const staffApi = {
  /** Текущий сотрудник — тот, чью личность подставил шлюз. */
  me(): Promise<Staff> {
    return request<Staff>('/staff/me')
  },

  list(): Promise<StaffListResponse> {
    return request<StaffListResponse>('/staff')
  },

  get(id: number): Promise<Staff> {
    return request<Staff>(`/staff/${id}`)
  },

  changeRole(id: number, role: StaffRole): Promise<Staff> {
    return request<Staff>(`/staff/${id}/role`, { method: 'PATCH', body: { role } })
  },

  deactivate(id: number): Promise<Staff> {
    return request<Staff>(`/staff/${id}`, { method: 'DELETE' })
  },
}
