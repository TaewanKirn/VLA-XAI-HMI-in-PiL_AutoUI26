import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Heart, Volume2, X, Maximize2, Shrink, ListMusic, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'

const lyrics = `Time moves slow
When you're all alone
And the time moves slow
When you're out on your own
And the time moves slow
When you're missing a friend
And the time moves slow
When you came to the end`

export default function MusicApp({ isFullscreen, setIsFullscreen, isBriefingOpen, onClose }) {
  const [isPlaying, setIsPlaying] = useState(true)
  const [activeTab, setActiveTab] = useState('Playlist')

  // Handlers for window controls
  const handleClose = () => {
    onClose()
  }

  const handleFullscreen = () => {
    setIsFullscreen(!isFullscreen)
  }

  // Calculate dynamic width/position based on briefing panel state
  const briefingWidth = 420 + 30 + 16 // panel width + right margin + gap
  const getWidth = () => {
    if (isFullscreen && isBriefingOpen) return 1920 - briefingWidth
    if (isFullscreen) return 1920
    if (isBriefingOpen) return 1410 - briefingWidth
    return 1410
  }
  const getLeft = () => {
    if (isFullscreen) return 0
    return 461
  }

  const isNarrow = !isFullscreen || isBriefingOpen;

  return (
    <motion.div
      initial={{ 
        opacity: 0, 
        y: 60,
        left: getLeft(),
        top: isFullscreen ? 79 : 104,
        width: getWidth(),
        height: isFullscreen ? 880 : 830
      }}
      animate={{ 
        opacity: 1, 
        y: 0, 
        scale: 1,
        width: getWidth(),
        height: isFullscreen ? 880 : 830,
        left: getLeft(),
        top: isFullscreen ? 79 : 104,
      }}
      exit={{ opacity: 0, y: 60 }}
      transition={{ type: "spring", stiffness: 250, damping: 30 }}
      className={`absolute z-30 overflow-hidden ${isFullscreen ? '' : 'border border-[rgba(19,20,23,0.05)]'}`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(237,238,242,0.95) 100%)',
        backdropFilter: 'blur(20px)',
        boxShadow: isFullscreen ? 'none' : '0px 12px 48px 0px rgba(0,0,0,0.12)',
        borderRadius: isFullscreen ? '0px' : '32px'
      }}
    >
      {/* Window Controls (Top Right) */}
      <div className="absolute top-[30px] right-[40px] flex items-center gap-[16px] z-10">
        <button 
          onClick={handleFullscreen}
          className="w-[48px] h-[48px] rounded-full bg-white border border-[rgba(19,20,23,0.1)] shadow-[0px_4px_12px_rgba(0,0,0,0.05)] hover:bg-[#f7f8fa] transition-all flex items-center justify-center text-[#131417]"
        >
          {isFullscreen ? <Shrink size={20} /> : <Maximize2 size={20} />}
        </button>
        <button 
          onClick={handleClose}
          className="w-[48px] h-[48px] rounded-full bg-white border border-[rgba(19,20,23,0.1)] shadow-[0px_4px_12px_rgba(0,0,0,0.05)] hover:bg-[#f7f8fa] transition-all flex items-center justify-center text-[#131417]"
        >
          <X size={24} />
        </button>
      </div>

      <div className="flex w-full h-full">
        {/* Sidebar */}
        <div 
          className={`border-r border-[rgba(19,20,23,0.05)] bg-[rgba(255,255,255,0.3)] flex flex-col pt-[40px] shrink-0 transition-all duration-300 ${
            isNarrow ? 'w-[100px] items-center' : 'w-[260px]'
          }`}
        >
          <div className="flex flex-col gap-[8px] px-[16px] mt-[80px]">
            {[
              { id: 'Playlist', icon: ListMusic },
              { id: 'Search', icon: Search },
              { id: 'For You', icon: Sparkles },
            ].map((tab) => (
              <button 
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center rounded-[16px] transition-all ${
                  activeTab === tab.id 
                    ? 'bg-white shadow-[0px_2px_8px_rgba(0,0,0,0.04)] text-[#131417]' 
                    : 'text-[#666] hover:bg-[rgba(255,255,255,0.5)]'
                } ${isNarrow ? 'justify-center w-[68px] h-[60px] mx-auto' : 'px-[20px] py-[16px]'}`}
              >
                <tab.icon size={22} className={activeTab === tab.id ? 'text-[#131417]' : ''} />
                {!isNarrow && <span className={`ml-[16px] text-[18px] ${activeTab === tab.id ? 'font-medium' : ''}`}>{tab.id}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Main Music Content */}
        <div className={`flex-1 flex h-full p-[60px] ${isNarrow ? 'gap-[40px]' : 'gap-[60px]'} overflow-hidden`}>
          {/* Left: Album Art */}
          <div className="transition-all duration-500 ease-in-out flex flex-col justify-center shrink-0" style={{ width: isNarrow ? '300px' : isBriefingOpen ? '400px' : '480px' }}>
            <motion.div 
              className="rounded-[60px] overflow-hidden shadow-[0px_20px_60px_rgba(0,0,0,0.3)] relative aspect-square w-full"
            layout
          >
            <img 
              src="/album.jpg" 
              alt="Time Moves Slow - BADBADNOTGOOD" 
              className="w-full h-full object-cover"
            />
            {/* Glossy overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-white/20 pointer-events-none" />
          </motion.div>
        </div>

        {/* Middle: Player Controls & Info */}
        <div className="flex-1 flex flex-col justify-center py-[20px]">
          {/* Track Info */}
          <div className="mb-[50px]">
            <div className="flex items-center gap-6 mb-4">
              <h2 className="text-[54px] font-bold text-[#131417] leading-tight tracking-tight">Time Moves Slow</h2>
              <button className="text-[#99a1af] hover:text-[#ff4757] transition-colors pt-2">
                <Heart size={44} />
              </button>
            </div>
            <p className="text-[32px] font-medium text-[#99a1af]">BADBADNOTGOOD</p>
            <div className="mt-6 inline-block px-4 py-1.5 bg-[#131417]/5 rounded-full">
              <span className="text-[16px] font-semibold text-[#131417]/60 tracking-wider uppercase">Soul Jazz</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-[60px]">
            <div className="h-[8px] bg-[#131417]/10 rounded-full w-full relative cursor-pointer group">
              <div className="absolute top-0 left-0 h-full w-[35%] bg-[#131417] rounded-full" />
              <div className="absolute top-1/2 left-[35%] -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-white rounded-full shadow-md scale-0 group-hover:scale-100 transition-transform" />
            </div>
            <div className="flex justify-between mt-4">
              <span className="text-[18px] font-medium text-[#99a1af]">1:32</span>
              <span className="text-[18px] font-medium text-[#99a1af]">-2:55</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between px-[10px] mb-[60px]">
            <button className="text-[#99a1af] hover:text-[#131417] transition-colors shrink-0">
              <Shuffle size={isNarrow ? 24 : 32} />
            </button>
            
            <div className={`flex items-center ${isNarrow ? 'gap-[24px]' : 'gap-[40px]'} shrink-0`}>
              <motion.button 
                whileTap={{ scale: 0.9 }}
                className="text-[#131417] hover:text-black transition-colors"
              >
                <SkipBack size={isNarrow ? 36 : 48} fill="currentColor" />
              </motion.button>
              
              <motion.button 
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsPlaying(!isPlaying)}
                className={`${isNarrow ? 'w-[80px] h-[80px]' : 'w-[100px] h-[100px]'} bg-[#131417] rounded-full flex items-center justify-center text-white shadow-xl hover:bg-black transition-colors shrink-0`}
              >
                {isPlaying ? (
                  <Pause size={isNarrow ? 32 : 40} fill="currentColor" />
                ) : (
                  <Play size={isNarrow ? 32 : 40} fill="currentColor" className={isNarrow ? "ml-1" : "ml-2"} />
                )}
              </motion.button>
              
              <motion.button 
                whileTap={{ scale: 0.9 }}
                className="text-[#131417] hover:text-black transition-colors"
              >
                <SkipForward size={isNarrow ? 36 : 48} fill="currentColor" />
              </motion.button>
            </div>

            <button className="text-[#131417] transition-colors relative shrink-0">
              <Repeat size={isNarrow ? 24 : 32} />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full"></span>
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-6 mt-auto">
            <Volume2 size={24} className="text-[#99a1af]" />
            <div className="h-[6px] bg-[#131417]/10 rounded-full w-[200px] relative cursor-pointer">
              <div className="absolute top-0 left-0 h-full w-[70%] bg-[#99a1af] rounded-full" />
            </div>
          </div>
        </div>

        {/* Right: Lyrics (Only visible in Fullscreen) */}
        <AnimatePresence>
          {isFullscreen && (
            <motion.div 
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50, transition: { duration: 0.2 } }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="flex-1 flex flex-col justify-center py-[20px] pl-[40px] border-l border-[#131417]/10"
            >
              <h3 className="text-[24px] font-bold text-[#131417] mb-[40px] tracking-tight">Lyrics</h3>
              <div className="flex flex-col gap-[24px]">
                {lyrics.split('\n').map((line, index) => (
                  <motion.p 
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.05 }}
                    className={`text-[28px] leading-tight ${
                      index === 2 ? 'text-[#131417] font-bold scale-105 origin-left' : 'text-[#99a1af] font-medium'
                    } transition-all duration-300`}
                  >
                    {line}
                  </motion.p>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
