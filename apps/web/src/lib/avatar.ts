const AVATAR_COLORS = [
  '#7EBAD7', '#F0B96A', '#E07B7B', '#8BC58B', '#C49ADB',
  '#6BB8C4', '#D4A45A', '#B07B9E', '#7BAFB0', '#C4946B',
]

export function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!
}

export function avatarInitial(name: string): string {
  return name.charAt(0) || '?'
}
