import { GripVertical, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { usePlayer } from '../../context/PlayerContext.jsx'
import Artwork from '../music/Artwork.jsx'
import IconButton from '../ui/IconButton.jsx'

// Çalma Sırası Listesi — Neo-brutalist Sürükle-bırak Sıralama ve Parçaya Atlama
export default function QueueList({ compact = false }) {
  const player = usePlayer()
  const [dragged, setDragged] = useState(null)

  if (!player.current || !player.queue.length) {
    return (
      <p style={{ padding: '24px 8px', textAlign: 'center', fontSize: '0.9rem', fontWeight: 700, color: 'rgba(0,0,0,0.7)' }}>
        Sıra boş. Bir parça çalmaya başladığında burada görünecek.
      </p>
    )
  }

  return (
    <div className={`queue-list ${compact ? 'queue-list--compact' : ''}`}>
      {player.queue.map((track, index) => {
        const isCurrent = index === player.index

        return (
          <div
            key={`${track.id}-${index}`}
            className={`queue-item ${isCurrent ? 'is-current' : ''}`}
            draggable={!isCurrent}
            onDragStart={() => setDragged(index)}
            onDragEnd={() => setDragged(null)}
            onDragOver={(event) => {
              if (!isCurrent) event.preventDefault()
            }}
            onDrop={() => {
              if (dragged !== null && !isCurrent) {
                player.moveQueueItem(dragged, index)
              }
              setDragged(null)
            }}
          >
            <span className="queue-item__grip" aria-hidden="true">
              {isCurrent ? (
                <span style={{ color: '#000000' }}>
                  <Play size={15} strokeWidth={3} fill="currentColor" />
                </span>
              ) : (
                <GripVertical size={18} strokeWidth={2.5} />
              )}
            </span>

            <button
              type="button"
              className="queue-item__main"
              onClick={() => player.jump(index)}
              aria-label={`${track.title} parçasına atla`}
            >
              <span className="queue-item__art">
                <Artwork src={track.cover_url} alt={`${track.title} kapağı`} seed={track.id} />
              </span>
              <span style={{ minWidth: 0 }}>
                <strong title={track.title}>{track.title}</strong>
                <small title={track.artist}>{track.artist}</small>
              </span>
            </button>

            {!isCurrent && (
              <IconButton
                className="queue-item__remove"
                label="Sıradan kaldır"
                onClick={() => player.removeFromQueue(index)}
                style={{ width: 28, height: 28, borderWidth: 2 }}
              >
                <Trash2 size={14} strokeWidth={2.5} />
              </IconButton>
            )}
          </div>
        )
      })}
    </div>
  )
}
