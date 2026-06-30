import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, Shrink, Search, Phone as PhoneIcon, User, Clock, Star, PhoneCall, Video, MessageSquare, Mic, Volume2, UserPlus } from 'lucide-react'
import { useState } from 'react'

export default function PhoneApp({ isFullscreen, setIsFullscreen, isBriefingOpen, onClose }) {
  const [activeView, setActiveView] = useState('Recents')
  const [selectedContact, setSelectedContact] = useState(null)
  
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

  const contacts = [
    { id: 1, name: 'Jane Cooper', status: 'Mobile', time: '10:24 AM', color: 'bg-blue-500' },
    { id: 2, name: 'Wade Warren', status: 'Work', time: 'Yesterday', color: 'bg-green-500' },
    { id: 3, name: 'Esther Howard', status: 'Mobile', time: 'Yesterday', color: 'bg-purple-500' },
    { id: 4, name: 'Cameron Williamson', status: 'Home', time: 'Monday', color: 'bg-orange-500' },
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
          <div className="flex flex-col gap-[8px] px-[16px] mt-[40px]">
            {[
              { icon: Star, id: 'Favorites' },
              { icon: Clock, id: 'Recents' },
              { icon: User, id: 'Contacts' },
              { icon: PhoneIcon, id: 'Keypad' },
            ].map((view) => (
              <button 
                key={view.id}
                onClick={() => setActiveView(view.id)}
                className={`flex items-center rounded-[16px] transition-all ${
                  activeView === view.id 
                    ? 'bg-white shadow-[0px_2px_8px_rgba(0,0,0,0.04)] text-[#131417]' 
                    : 'text-[#666] hover:bg-[rgba(255,255,255,0.5)]'
                } ${isNarrow ? 'justify-center w-[68px] h-[60px] mx-auto' : 'px-[20px] py-[16px]'}`}
              >
                <view.icon size={22} className={activeView === view.id ? 'text-[#131417]' : ''} />
                {!isNarrow && <span className={`ml-[16px] text-[18px] ${activeView === view.id ? 'font-medium' : ''}`}>{view.id}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* List & Profile Container */}
        <div className="flex-1 flex overflow-hidden">
          {/* List */}
          <div className={`${isNarrow ? 'w-full' : 'w-[450px]'} flex flex-col border-r border-[rgba(19,20,23,0.05)] bg-[rgba(255,255,255,0.1)]`}>
             <div className="h-[120px] px-[40px] flex items-center justify-between shrink-0">
               <h2 className="text-[32px] font-bold text-[#131417]">{activeView}</h2>
               <button className="text-[#2d7cf1]"><UserPlus size={24} /></button>
             </div>
             
             <div className="flex-1 overflow-y-auto px-[20px]">
               <div className="px-4 mb-6">
                  <div className="relative">
                    <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#99a1af]" />
                    <input type="text" placeholder="Search contacts" className="w-full h-[54px] bg-[rgba(19,20,23,0.05)] rounded-[16px] pl-[48px] pr-[20px] text-[18px] outline-none" />
                  </div>
               </div>
               {contacts.map(contact => (
                 <motion.div 
                   key={contact.id}
                   whileHover={{ x: 5 }}
                   onClick={() => setSelectedContact(contact)}
                   className={`p-[20px] rounded-[24px] mb-[8px] cursor-pointer transition-all flex items-center gap-4 ${
                     selectedContact?.id === contact.id ? 'bg-white shadow-[0px_10px_30px_rgba(0,0,0,0.08)]' : 'hover:bg-white/50'
                   }`}
                 >
                   <div className={`w-[60px] h-[60px] rounded-full ${contact.color} flex items-center justify-center text-white text-[22px] font-bold`}>
                     {contact.name.charAt(0)}
                   </div>
                   <div className="flex-1">
                     <h4 className="text-[20px] font-bold text-[#131417]">{contact.name}</h4>
                     <p className="text-[16px] text-[#99a1af]">{contact.status}</p>
                   </div>
                   <span className="text-[14px] text-[#99a1af]">{contact.time}</span>
                 </motion.div>
               ))}
             </div>
          </div>

          {/* Profile/Call (Only shown if not narrow) */}
          {!isNarrow && (
            <div className="flex-1 flex flex-col bg-white/30 items-center justify-center">
               {selectedContact ? (
                 <div className="flex flex-col items-center max-w-[600px] w-full">
                    <motion.div 
                      layoutId={`avatar-${selectedContact.id}`}
                      className={`w-[180px] h-[180px] rounded-full ${selectedContact.color} flex items-center justify-center text-white text-[64px] font-bold mb-8 shadow-2xl`}
                    >
                      {selectedContact.name.charAt(0)}
                    </motion.div>
                    <h1 className="text-[48px] font-bold text-[#131417] mb-2">{selectedContact.name}</h1>
                    <p className="text-[24px] text-[#99a1af] mb-12">{selectedContact.status} · 010-1234-5678</p>
                    
                    <div className="flex gap-[32px] mb-16">
                       <button className="w-[84px] h-[84px] rounded-full bg-[#34C759] flex items-center justify-center text-white shadow-xl hover:scale-105 transition-all"><PhoneCall size={32} fill="currentColor" /></button>
                       <button className="w-[84px] h-[84px] rounded-full bg-[#2d7cf1] flex items-center justify-center text-white shadow-xl hover:scale-105 transition-all"><Video size={32} fill="currentColor" /></button>
                       <button className="w-[84px] h-[84px] rounded-full bg-white border border-[rgba(19,20,23,0.1)] flex items-center justify-center text-[#131417] shadow-xl hover:scale-105 transition-all"><MessageSquare size={32} fill="currentColor" /></button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 w-full px-[40px]">
                       <div className="bg-white/50 p-6 rounded-[24px] border border-white/50">
                          <p className="text-[14px] font-bold text-[#99a1af] uppercase tracking-wider mb-2">Last Call</p>
                          <p className="text-[20px] font-bold text-[#131417]">Incoming · 10:24 AM</p>
                       </div>
                       <div className="bg-white/50 p-6 rounded-[24px] border border-white/50">
                          <p className="text-[14px] font-bold text-[#99a1af] uppercase tracking-wider mb-2">Duration</p>
                          <p className="text-[20px] font-bold text-[#131417]">12 mins 34 secs</p>
                       </div>
                    </div>
                 </div>
               ) : (
                 <div className="flex flex-col items-center opacity-30">
                    <PhoneIcon size={120} className="mb-8" />
                    <h3 className="text-[32px] font-bold">Select a contact to call</h3>
                 </div>
               )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
