import type { RouteResult } from '../integrations/routes-api'

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} 分`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} 小時` : `${h} 小時 ${m} 分`
}

export function formatRouteRow(route: RouteResult): string {
  const parts: string[] = []
  if (route.driving) parts.push(`🚗 ${formatMinutes(route.driving.duration_minutes)}`)
  if (route.transit) parts.push(`🚇 ${formatMinutes(route.transit.duration_minutes)}`)
  return parts.join('　　')
}
