export function mediaKey(item = {}, type = 'media', index = 0) {
  const identity = item.id ?? item.uri ?? item.name ?? item.title ?? 'item'
  return `${type}:${String(identity)}:${index}`
}
