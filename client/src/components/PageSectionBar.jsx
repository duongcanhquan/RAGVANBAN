import MainSectionNav from './MainSectionNav'

/** Thanh nav trên cùng trang Thư viện / Tình huống (desktop). */
export default function PageSectionBar() {
  return (
    <div className="sticky top-0 z-20 hidden shrink-0 border-b border-white/10 bg-black/20 px-3 py-2 backdrop-blur-md lg:flex sm:px-4 xl:px-6">
      <MainSectionNav />
    </div>
  )
}
