import React, {useEffect, useMemo, useState} from "react"

import MinidenticonImg from "./MinidenticonImg.tsx"
import ProxyImg from "./ProxyImg.tsx"
import useProfile from "../hooks/useProfile.ts"
import {Badge} from "./Badge"

export const Avatar = ({
  width = 45,
  pubKey,
  showBadge = true,
  showTooltip = true,
}: {
  width?: number
  pubKey: string
  showBadge?: boolean
  showTooltip?: boolean
  showHoverCard?: boolean
}) => {
  const profile = useProfile(pubKey)
  const [image, setImage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [hasImageError, setHasImageError] = useState(false)

  useEffect(() => {
    // Reset all states when profile or pubKey changes
    setHasImageError(false)
    setIsLoading(false)
    setImage("")
    
    if (profile?.picture) {
      setIsLoading(true)
      setImage(String(profile.picture))
    }
  }, [profile, pubKey])

  const handleImageError = () => {
    setImage("")
    setIsLoading(false)
    setHasImageError(true)
  }

  const handleImageLoad = () => {
    setIsLoading(false)
    setHasImageError(false)
  }

  // Show minidenticon if no image, image failed to load, or still loading
  const shouldShowMinidenticon = !image || hasImageError || isLoading

  return (
    <div
      className={`aspect-square rounded-full bg-base-100 flex items-center justify-center select-none relative`}
      style={{width, height: width}}
    >
      {showBadge && (
        <Badge
          pubKey={pubKey}
          className="absolute top-0 right-0 transform translate-x-1/3 -translate-y-1/3"
        />
      )}
      <div
        className="w-full rounded-full overflow-hidden aspect-square not-prose"
        title={
          showTooltip
            ? String(
                profile?.name ||
                  profile?.display_name ||
                  profile?.username ||
                  profile?.nip05?.split("@")[0] ||
                  pubKey.slice(0,8) + "..."
              )
            : ""
        }
      >
        {image && !hasImageError ? (
          <div key={`${pubKey}-${image}`} className="relative w-full h-full">
            {/* Always show minidenticon as base layer */}
            <MinidenticonImg username={pubKey} />
            
            {/* Only show image when it's loaded successfully */}
            <ProxyImg
              width={width}
              square={true}
              src={image}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover ${isLoading || hasImageError ? 'opacity-0 pointer-events-none' : 'opacity-100'} transition-opacity duration-200`}
              onError={handleImageError}
              onLoad={handleImageLoad}
              hideBroken={true}
            />
          </div>
        ) : (
          <MinidenticonImg username={pubKey} />
        )}
      </div>
    </div>
  )
}
