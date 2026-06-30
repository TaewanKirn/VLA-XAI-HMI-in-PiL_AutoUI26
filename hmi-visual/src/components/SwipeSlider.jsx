import { useState } from 'react'
import { motion, AnimatePresence, useAnimation, useMotionValue, useTransform } from 'framer-motion'
import { Check } from 'lucide-react'

// Visual constants — the actual track width is set by the parent (w-full),
// but the maxDrag math needs to know thumb width + side padding so the
// thumb's rounded edge doesn't visually intersect the track's rounded edge.
const TRACK_W      = 344  // matches w-408 card minus p-32
const TRACK_PAD_X  = 6    // breathing space each side (track is rounded-full ~31px, thumb is rounded-27px — without this they intersect)
const THUMB_W      = 223
const MAX_DRAG     = TRACK_W - THUMB_W - TRACK_PAD_X * 2  // 109

export default function SwipeSlider({ onApprove, text = '밀어서 우회 경로 승인' }) {
  const [isApproved, setIsApproved] = useState(false)
  const controls = useAnimation()
  const x = useMotionValue(0)

  // Background tints from drag progress — track gradually turns blue as the
  // user pushes the thumb, giving immediate "you're committing" feedback.
  const trackGradient = useTransform(
    x,
    [0, MAX_DRAG],
    ['rgba(217,217,217,1)', 'rgba(45,124,241,0.18)']
  )
  // SWIPE hint fades out
  const hintOpacity = useTransform(x, [0, MAX_DRAG * 0.4], [1, 0])

  const handleDragEnd = (_e, info) => {
    if (info.offset.x >= MAX_DRAG * 0.6) {
      // Approved → slide thumb to end, expand into a full check, fire callback after
      controls.start({ x: MAX_DRAG, transition: { type: 'spring', stiffness: 320, damping: 28 } })
      setIsApproved(true)
      setTimeout(() => { onApprove?.() }, 900)
    } else {
      controls.start({ x: 0, transition: { type: 'spring', stiffness: 320, damping: 26 } })
    }
  }

  return (
    <motion.div
      className="relative flex items-center h-[63px] w-full rounded-full overflow-hidden border border-[rgba(19,20,23,0.05)]"
      style={{ backgroundColor: isApproved ? '#2d7cf1' : trackGradient, paddingLeft: TRACK_PAD_X, paddingRight: TRACK_PAD_X }}
      animate={isApproved ? { backgroundColor: '#2d7cf1' } : {}}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Hint label (fades as user drags) */}
      <AnimatePresence>
        {!isApproved && (
          <motion.span
            style={{ opacity: hintOpacity }}
            className="absolute right-[24px] top-1/2 -translate-y-1/2 text-[14px] text-black/25 font-medium tracking-wide pointer-events-none select-none"
          >
            SWIPE
          </motion.span>
        )}
      </AnimatePresence>

      {/* Success overlay — text + animated checkmark fills entire track */}
      <AnimatePresence>
        {isApproved && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.3 }}
            className="absolute inset-0 flex items-center justify-center gap-[10px] pointer-events-none select-none"
          >
            <motion.div
              initial={{ scale: 0, rotate: -45 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.3, type: 'spring', stiffness: 360, damping: 18 }}
              className="flex items-center justify-center w-[28px] h-[28px] rounded-full bg-white"
            >
              <Check size={18} strokeWidth={3} color="#2d7cf1" />
            </motion.div>
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="text-white text-[18px] font-semibold tracking-[-0.4px]"
            >
              우회 경로 승인됨
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Draggable thumb */}
      <motion.div
        drag={isApproved ? false : 'x'}
        dragConstraints={{ left: 0, right: MAX_DRAG }}
        dragElastic={0.06}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        animate={controls}
        style={{ x }}
        // When approved, fade the thumb out so the success overlay can read cleanly
        whileDrag={{ cursor: 'grabbing' }}
        className={`relative z-10 flex items-center gap-[8px] h-[50px] min-h-[48px] pl-[20px] pr-[16px] rounded-[27px] shrink-0 w-[223px] cursor-grab bg-white drop-shadow-[0px_1px_3.5px_rgba(0,0,0,0.28)] transition-opacity duration-300 ${isApproved ? 'opacity-0' : 'opacity-100'}`}
      >
        <p className="font-medium leading-[1.4] text-[#131417] text-[18px] tracking-[-0.9px] whitespace-nowrap select-none">
          {text}
        </p>
        <div className="ml-auto w-[24px] h-[24px] flex items-center justify-center pointer-events-none">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M10 6L16 12L10 18" stroke="#2D7CF1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 6L11 12L5 18" stroke="#2D7CF1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
          </svg>
        </div>
      </motion.div>
    </motion.div>
  )
}
