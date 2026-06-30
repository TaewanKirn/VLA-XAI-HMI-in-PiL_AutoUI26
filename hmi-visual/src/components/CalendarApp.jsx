import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, Shrink, Search, Plus, Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, MapPin, Users } from 'lucide-react'
import { useState } from 'react'

export default function CalendarApp({ isFullscreen, setIsFullscreen, isBriefingOpen, onClose }) {
  const [selectedDate, setSelectedDate] = useState(8) // Default to May 8
  
  const handleClose = () => onClose()
  const handleFullscreen = () => setIsFullscreen(!isFullscreen)

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

  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const dates = Array.from({ length: 31 }, (_, i) => i + 1)
  
  const events = [
    { id: 1, day: 8, title: 'Project Orion Review', time: '10:00 AM - 11:30 AM', location: 'Meeting Room A', participants: 5, color: 'bg-[#2d7cf1]' },
    { id: 2, day: 8, title: 'Design Sync', time: '2:00 PM - 3:00 PM', location: 'Zoom', participants: 3, color: 'bg-[#AF52DE]' },
    { id: 3, day: 9, title: 'Weekly Standup', time: '9:00 AM - 9:30 AM', location: 'Team Space', participants: 12, color: 'bg-[#34C759]' },
    { id: 4, day: 12, title: 'Tesla Service Appt', time: '11:00 AM', location: 'Service Center', participants: 1, color: 'bg-[#131417]' },
  ]

  const selectedEvents = events.filter(e => e.day === selectedDate)

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
      className={`absolute z-30 overflow-hidden flex ${isFullscreen ? '' : 'border border-[rgba(19,20,23,0.05)]'}`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(237,238,242,0.95) 100%)',
        backdropFilter: 'blur(20px)',
        boxShadow: isFullscreen ? 'none' : '0px 12px 48px 0px rgba(0,0,0,0.12)',
        borderRadius: isFullscreen ? '0px' : '32px'
      }}
    >
      {/* Window Controls */}
      <div className="absolute top-[30px] right-[40px] flex items-center gap-[16px] z-20">
        <button 
          onClick={handleFullscreen}
          className="btn-window-ctrl"
          aria-label={isFullscreen ? "축소" : "최대화"}
        >
          {isFullscreen ? <Shrink size={20} /> : <Maximize2 size={20} />}
        </button>
        <button 
          onClick={handleClose}
          className="btn-window-ctrl"
          aria-label="닫기"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex w-full h-full">
        {/* Sidebar */}
        <div 
          className={`border-r border-[rgba(19,20,23,0.05)] bg-[rgba(255,255,255,0.3)] flex flex-col pt-[40px] shrink-0 transition-all duration-300 ${
            isNarrow ? 'w-[100px] items-center' : 'w-[260px]'
          }`}
        >
          <div className={`px-[20px] mb-[40px] flex ${isNarrow ? 'justify-center' : 'justify-start'}`}>
            <button className={`btn-primary !rounded-full !shadow-[0px_6px_16px_rgba(45,124,241,0.2)] ${isNarrow ? 'justify-center w-[60px] h-[60px] p-0' : 'w-[220px]'}`}>
              <Plus size={22} />
              {!isNarrow && <span className="ml-[12px] text-[18px]">New Event</span>}
            </button>
          </div>
          
          <div className="flex flex-col gap-[8px] px-[16px]">
            {[
              { icon: CalendarIcon, label: 'Month', active: true },
              { icon: Clock, label: 'Schedule' },
              { icon: Users, label: 'Shared' },
            ].map((item, i) => (
              <button 
                key={i}
                className={`sidebar-tab ${item.active ? 'active' : ''} ${
                  isNarrow ? 'justify-center w-[68px] h-[60px] mx-auto' : 'px-[20px] py-[16px] w-[228px]'
                }`}
              >
                <item.icon size={22} />
                {!isNarrow && <span className="ml-[16px] text-[18px]">{item.label}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Main Calendar View */}
        <div className="flex-1 border-r border-[rgba(19,20,23,0.05)] bg-[rgba(255,255,255,0.5)] flex flex-col">
          <div className={`h-[120px] px-[40px] flex items-center justify-between shrink-0 ${isNarrow ? 'pr-[220px]' : 'pr-[40px]'}`}>
            <div className="flex items-center gap-[24px]">
              <h2 className="text-[32px] font-bold text-[#131417] tracking-tight">May 2026</h2>
              <div className="flex gap-[8px]">
                <button className="p-2 hover:bg-white rounded-full transition-all border border-transparent hover:border-[rgba(19,20,23,0.1)]">
                  <ChevronLeft size={24} />
                </button>
                <button className="p-2 hover:bg-white rounded-full transition-all border border-transparent hover:border-[rgba(19,20,23,0.1)]">
                  <ChevronRight size={24} />
                </button>
              </div>
            </div>
            <div className="flex bg-[rgba(19,20,23,0.05)] p-[4px] rounded-[12px]">
              <button className="px-4 py-2 bg-white rounded-[9px] shadow-sm text-sm font-semibold text-[#2d7cf1]">Month</button>
              <button className="px-4 py-2 text-sm font-medium text-[#666] hover:text-[#131417] transition-colors">Week</button>
              <button className="px-4 py-2 text-sm font-medium text-[#666] hover:text-[#131417] transition-colors">Day</button>
            </div>
          </div>
          
          <div className="flex-1 p-[40px] pt-0">
            <div className="grid grid-cols-7 mb-4">
              {days.map(day => (
                <div key={day} className="text-center text-[14px] font-bold text-[#99a1af] py-2">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2 h-full pb-[40px]">
              {/* Empty slots for start of month - assuming May 2026 starts on Friday */}
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={`empty-${i}`} className="h-full rounded-2xl bg-transparent"></div>
              ))}
              {dates.map(date => {
                const hasEvent = events.some(e => e.day === date)
                const isSelected = selectedDate === date
                const isToday = date === 8
                
                return (
                  <button 
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    className={`relative h-full min-h-[100px] rounded-2xl p-4 transition-all flex flex-col items-center justify-start ${
                      isSelected 
                        ? 'bg-white shadow-[0px_10px_25px_rgba(0,0,0,0.08)] ring-2 ring-[#2d7cf1]' 
                        : 'hover:bg-white/60 bg-white/30'
                    }`}
                  >
                    <span className={`text-[18px] font-bold ${
                      isToday ? 'text-[#2d7cf1]' : 'text-[#131417]'
                    }`}>{date}</span>
                    {hasEvent && (
                      <div className="mt-2 flex gap-1 flex-wrap justify-center">
                        {events.filter(e => e.day === date).map(e => (
                          <div key={e.id} className={`w-2 h-2 rounded-full ${e.color}`}></div>
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Agenda View */}
        {!isNarrow && (
          <div className="w-[400px] flex flex-col bg-[rgba(255,255,255,0.2)]">
            <div className="h-[120px] px-[40px] pr-[40px] flex items-center shrink-0 border-b border-[rgba(19,20,23,0.05)]">
              <div className="flex flex-col">
                <h3 className="text-[32px] font-bold text-[#131417] tracking-tight">Agenda</h3>
                <span className="text-[15px] text-[#99a1af] mt-1">Friday, May {selectedDate}</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-[40px] flex flex-col gap-6">
              {selectedEvents.length > 0 ? (
                selectedEvents.map(event => (
                  <div key={event.id} className="flex flex-col gap-3 group">
                    <div className="flex items-start gap-4">
                      <div className={`w-1.5 h-16 rounded-full ${event.color} shrink-0`}></div>
                      <div className="flex flex-col">
                        <span className="text-[14px] font-bold text-[#2d7cf1] mb-1">{event.time}</span>
                        <h4 className="text-[18px] font-bold text-[#131417] leading-tight mb-2">{event.title}</h4>
                        <div className="flex items-center gap-4 text-[#666]">
                          <div className="flex items-center gap-1">
                            <MapPin size={14} />
                            <span className="text-[14px]">{event.location}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users size={14} />
                            <span className="text-[14px]">{event.participants}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40 py-20">
                  <CalendarIcon size={48} className="mb-4" />
                  <p className="text-[18px] font-medium">No events scheduled</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
