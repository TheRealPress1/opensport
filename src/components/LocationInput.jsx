import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTeamSettings } from '../lib/TeamSettingsContext'

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

let loadPromise = null
function loadGoogleMapsScript() {
  if (window.google?.maps?.places) return Promise.resolve()
  if (loadPromise) return loadPromise
  if (!GOOGLE_API_KEY) return Promise.reject(new Error('Missing VITE_GOOGLE_MAPS_API_KEY'))

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places`
    script.async = true
    script.onload = resolve
    script.onerror = () => reject(new Error('Failed to load Google Maps'))
    document.head.appendChild(script)
  })
  return loadPromise
}

export default function LocationInput({ value, onChange, placeholder, className, id = 'location' }) {
  const { demo } = useTeamSettings()
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const serviceRef = useRef(null)
  const inputRef = useRef(null)
  const wrapperRef = useRef(null)
  const dropdownRef = useRef(null)

  // Load Google Maps script
  useEffect(() => {
    if (demo || !GOOGLE_API_KEY) return
    loadGoogleMapsScript()
      .then(() => {
        serviceRef.current = new window.google.maps.places.AutocompleteService()
      })
      .catch(() => {})
  }, [demo])

  const [dropdownStyle, setDropdownStyle] = useState({})

  // Position dropdown relative to input
  const updatePosition = useCallback(() => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    })
  }, [])

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target) &&
          dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const fetchSuggestions = useCallback((input) => {
    if (!serviceRef.current || !input || input.length < 2) {
      setSuggestions([])
      return
    }
    serviceRef.current.getPlacePredictions(
      { input, types: ['establishment', 'geocode'] },
      (predictions, status) => {
        if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
          setSuggestions(predictions.slice(0, 5))
        } else {
          setSuggestions([])
        }
      }
    )
  }, [])

  const handleInputChange = (e) => {
    const val = e.target.value
    onChange(val)
    setShowSuggestions(true)
    updatePosition()
    fetchSuggestions(val)
  }

  const handleSelect = (suggestion) => {
    const selected = suggestion.description
    onChange(selected)
    setSuggestions([])
    setShowSuggestions(false)
  }

  // If no API key, just render a plain input
  if (demo || !GOOGLE_API_KEY) {
    return (
      <input
        id={id} aria-label="Location" type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
    )
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        id={id} aria-label="Location" type="text"
        value={value || ''}
        onChange={handleInputChange}
        onFocus={() => { updatePosition(); if (suggestions.length > 0) setShowSuggestions(true) }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {showSuggestions && suggestions.length > 0 && createPortal(
        <ul
          ref={dropdownRef}
          style={dropdownStyle}
          className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
          onMouseDown={(e) => e.preventDefault()}
        >
          {suggestions.map((s) => (
            <li key={s.place_id}>
              <button
                type="button"
                onClick={() => handleSelect(s)}
                className="w-full text-left px-3 py-2.5 text-sm text-gray-800 hover:bg-violet-50 transition-colors flex items-start gap-2"
              >
                <svg className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <div>
                  <div className="font-medium">{s.structured_formatting.main_text}</div>
                  <div className="text-xs text-gray-500">{s.structured_formatting.secondary_text}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  )
}
