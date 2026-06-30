import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, Shrink, Search, Plus, Mail as MailIcon, Star, Send, Trash2, ChevronRight, Inbox } from 'lucide-react'
import { useState } from 'react'

export default function MailApp({ isFullscreen, setIsFullscreen, isBriefingOpen, onClose }) {
  const [activeFolder, setActiveFolder] = useState('Inbox')
  
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

  const emails = [
    { id: 1, sender: 'Jane Cooper', subject: 'Project Orion Update', time: '10:24 AM', content: 'Hey, I just wanted to check in on the progress of the Orion UI...', unread: true },
    { id: 2, sender: 'Tesla Service', subject: 'Service Appointment Confirmed', time: 'Yesterday', content: 'Your service appointment for Friday, May 12 is confirmed...', unread: false },
    { id: 3, sender: 'Cameron Williamson', subject: 'Weekly Design Sync', time: 'May 5', content: 'The notes from our last meeting are attached below...', unread: false },
  ]

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
          <div className={`px-[20px] mb-[40px] flex ${isNarrow ? 'justify-center' : 'justify-start'}`}>
            <button className={`flex items-center rounded-full bg-[#131417] text-white shadow-[0px_6px_16px_rgba(19,20,23,0.2)] hover:scale-105 transition-all ${isNarrow ? 'justify-center w-[60px] h-[60px]' : 'px-[24px] h-[60px] w-[calc(100%-8px)]'}`}>
              <Plus size={22} />
              {!isNarrow && <span className="ml-[12px] text-[18px] font-semibold">New Mail</span>}
            </button>
          </div>
          
          <div className="flex flex-col gap-[8px] px-[16px]">
            {[
              { icon: Inbox, id: 'Inbox' },
              { icon: Star, id: 'Starred' },
              { icon: Send, id: 'Sent' },
              { icon: Trash2, id: 'Trash' },
            ].map((folder) => (
              <button 
                key={folder.id}
                onClick={() => setActiveFolder(folder.id)}
                className={`flex items-center rounded-[16px] transition-all ${
                  activeFolder === folder.id 
                    ? 'bg-white shadow-[0px_2px_8px_rgba(0,0,0,0.04)] text-[#131417]' 
                    : 'text-[#666] hover:bg-[rgba(255,255,255,0.5)]'
                } ${isNarrow ? 'justify-center w-[68px] h-[60px] mx-auto' : 'px-[20px] py-[16px]'}`}
              >
                <folder.icon size={22} className={activeFolder === folder.id ? 'text-[#131417]' : ''} />
                {!isNarrow && <span className={`ml-[16px] text-[18px] ${activeFolder === folder.id ? 'font-medium' : ''}`}>{folder.id}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* List & Content Container */}
        <div className="flex-1 flex overflow-hidden">
          {/* List */}
          <div className={`${isNarrow ? 'w-full' : 'w-[450px]'} flex flex-col border-r border-[rgba(19,20,23,0.05)] bg-[rgba(255,255,255,0.1)]`}>
             <div className="h-[120px] px-[40px] flex items-center shrink-0">
               <h2 className="text-[32px] font-bold text-[#131417]">{activeFolder}</h2>
             </div>
             
             <div className="flex-1 overflow-y-auto px-[20px]">
               {emails.map(email => (
                 <motion.div 
                   key={email.id}
                   whileHover={{ x: 5 }}
                   className={`p-[24px] rounded-[24px] mb-[12px] cursor-pointer transition-all ${
                     email.id === 1 ? 'bg-white shadow-[0px_10px_30px_rgba(0,0,0,0.08)]' : 'hover:bg-white/50'
                   }`}
                 >
                   <div className="flex justify-between items-center mb-1">
                     <span className={`text-[18px] ${email.unread ? 'font-bold text-[#131417]' : 'text-[#666]'}`}>{email.sender}</span>
                     <span className="text-[14px] text-[#99a1af]">{email.time}</span>
                   </div>
                   <h4 className={`text-[16px] mb-2 ${email.unread ? 'font-bold text-[#131417]' : 'text-[#666]'}`}>{email.subject}</h4>
                   <p className="text-[15px] text-[#99a1af] line-clamp-2 leading-relaxed">{email.content}</p>
                 </motion.div>
               ))}
             </div>
          </div>

          {/* Body (Only shown if not narrow) */}
          {!isNarrow && (
            <div className="flex-1 flex flex-col bg-white/30 p-[60px]">
               <div className="mb-[60px] flex justify-between items-start">
                  <div>
                    <h1 className="text-[42px] font-bold text-[#131417] mb-2">Project Orion Update</h1>
                    <div className="flex items-center gap-3">
                       <div className="w-[40px] h-[40px] rounded-full bg-[#E85D5D] flex items-center justify-center text-white font-bold">JC</div>
                       <span className="text-[20px] font-medium text-[#131417]">Jane Cooper</span>
                       <span className="text-[18px] text-[#99a1af]">&lt;jane.c@orion.com&gt;</span>
                    </div>
                  </div>
                  <span className="text-[18px] text-[#99a1af]">10:24 AM (3 hours ago)</span>
               </div>
               
               <div className="flex-1 text-[20px] text-[#131417] leading-relaxed max-w-[800px]">
                 <p className="mb-6">Hey team,</p>
                 <p className="mb-6">I just wanted to check in on the progress of the Orion UI. The latest mocks you sent over look incredible, and the client was particularly impressed with the glassmorphism effects in the media player.</p>
                 <p className="mb-6">Do we have a timeline for when the ADAS simulation components will be ready for review? We'd like to schedule a demo for the end of the week if possible.</p>
                 <p>Best regards,<br/>Jane</p>
               </div>
               
               <div className="mt-[60px] pt-[40px] border-t border-[rgba(19,20,23,0.05)] flex gap-4">
                  <button className="px-[32px] py-[16px] bg-[#131417] text-white rounded-[16px] font-bold">Reply</button>
                  <button className="px-[32px] py-[16px] bg-white border border-[rgba(19,20,23,0.1)] text-[#131417] rounded-[16px] font-bold">Forward</button>
               </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
