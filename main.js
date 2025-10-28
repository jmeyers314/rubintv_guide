// Load both the blocks data and the translation table
Promise.all([
    d3.json("blocks.json"),
    d3.json("tblock_names.json")
]).then(function([blocks, tblockNames]) {
    // Parse date strings to Date objects
    blocks.forEach(d => {
        d.begin = new Date(d.begin);
        d.end = new Date(d.end);
    });

    // Filter out blocks shorter than 5 minutes (300,000 milliseconds)
    blocks = blocks.filter(d => {
        const durationMs = d.end - d.begin;
        return durationMs >= 300000; // 5 minutes = 300,000 milliseconds
    });

    // Helper function to get the base block name (without version suffix)
    function getBaseBlockName(program) {
        // Remove version suffix like _v3, _v2, _1, _2, etc.
        return program.replace(/_(?:v)?\d+$/, '');
    }

    // Helper function to get the correct T-block name for description lookup
    function getDescriptionKey(program) {
        // First remove any version suffix
        const baseProgram = getBaseBlockName(program);

        // If program is BLOCK-XYZ format (without T), try BLOCK-TXYZ
        const blockMatch = baseProgram.match(/^BLOCK-(\d+)$/);
        if (blockMatch) {
            const tBlockName = `BLOCK-T${blockMatch[1]}`;
            // Use T-block version if it exists in translation table, otherwise use base
            return tblockNames[tBlockName] ? tBlockName : baseProgram;
        }
        return baseProgram;
    }

    // Helper function to get description for a program
    function getDescription(program) {
        const descriptionKey = getDescriptionKey(program);
        return tblockNames[descriptionKey];
    }

    // Formatting helpers
    const fmtDate = d3.utcFormat("%Y-%m-%d"); // Use UTC formatting for dates too
    const fmtTime = d3.utcFormat("%H:%M"); // Use UTC formatting to match the astronomical convention
    const fmtTimeLocal = d3.timeFormat("%H:%M"); // Keep local time formatter for reference

    // Astronomical day functions - observation day runs from UTC-3 noon (15:00 UTC) to UTC-3 noon
    function getAstronomicalDay(date) {
        // Astronomical day is defined by the UTC-3 noon (15:00 UTC) that starts the 24-hour period
        // If time is before 15:00 UTC, the observation day started at yesterday's 15:00 UTC
        const currentDate = new Date(date);
        const currentHour = currentDate.getUTCHours();

        if (currentHour < 15) {
            // Before 15:00 UTC - observation day started yesterday at 15:00 UTC
            const yesterday = new Date(currentDate);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            return fmtDate(yesterday);
        } else {
            // After 15:00 UTC - observation day started today at 15:00 UTC
            return fmtDate(currentDate);
        }
    }

    function hoursSinceNoon(date) {
        // Calculate hours since the UTC-3 noon (15:00 UTC) that started this observation day
        const observationDayStr = getAstronomicalDay(date);
        const observationNoon = new Date(observationDayStr + "T15:00:00Z"); // 15:00 UTC

        let hoursSince = (date - observationNoon) / 3600000;

        // Handle case where date is in the next calendar day (early morning hours)
        if (hoursSince < 0) {
            hoursSince += 24;
        }

        return hoursSince;
    }

    // Preprocess Data - handle blocks that span across astronomical day boundaries
    const data = [];

    blocks.forEach((d, blockIndex) => {
        const startDay = getAstronomicalDay(d.begin);
        const endDay = getAstronomicalDay(d.end);
        const startDayNoon = new Date(startDay + "T15:00:00Z"); // UTC-3 noon = 15:00 UTC

        // Calculate positions relative to the start day's UTC-3 noon (15:00 UTC)
        const x0 = (d.begin - startDayNoon) / 3600000;
        const x1 = (d.end - startDayNoon) / 3600000;
        const durationH = (d.end - d.begin) / 3600000;

        if (startDay === endDay) {
            // Block doesn't span days, add as-is
            data.push({ ...d, day: startDay, x0, x1, durationH, originalBlock: null, isSpanningPart: false, blockId: blockIndex });
        } else {
            // Block spans across days - create entries for each day it touches
            // Generate list of astronomical days between start and end
            const spanDays = [];
            const currentDate = new Date(startDay + "T15:00:00Z"); // Start from startDay UTC-3 noon
            const endDate = new Date(endDay + "T15:00:00Z"); // End at endDay UTC-3 noon

            while (currentDate <= endDate) {
                spanDays.push(fmtDate(currentDate));
                currentDate.setDate(currentDate.getDate() + 1); // Move to next calendar day
            }

            spanDays.forEach((dayStr, dayIndex) => {
                const dayNoon = new Date(dayStr + "T15:00:00Z"); // UTC-3 noon = 15:00 UTC

                if (dayIndex === 0) {
                    // First day: from start time to end of astronomical day (24 hours from this day's UTC-3 noon)
                    data.push({
                        ...d,
                        day: dayStr,
                        x0: (d.begin - dayNoon) / 3600000,
                        x1: 24, // End at 24 hours (next UTC-3 noon)
                        durationH: durationH, // Keep original duration for info display
                        originalBlock: d,
                        isSpanningPart: true,
                        blockId: blockIndex
                    });
                } else if (dayIndex === spanDays.length - 1) {
                    // Last day: from start of astronomical day (0 hours) to actual end time
                    data.push({
                        ...d,
                        day: dayStr,
                        x0: 0, // Start at beginning of astronomical day (this day's noon)
                        x1: (d.end - dayNoon) / 3600000,
                        durationH: durationH, // Keep original duration for info display
                        originalBlock: d,
                        isSpanningPart: true,
                        blockId: blockIndex
                    });
                } else {
                    // Middle day: entire astronomical day (0 to 24 hours)
                    data.push({
                        ...d,
                        day: dayStr,
                        x0: 0,
                        x1: 24,
                        durationH: durationH, // Keep original duration for info display
                        originalBlock: d,
                        isSpanningPart: true,
                        blockId: blockIndex
                    });
                }
            });
        }
    });

    // Generate complete list of days (including empty days)
    const observedDays = Array.from(new Set(data.map(d => d.day))).sort(d3.ascending);

    // Find the date range
    const firstDay = new Date(observedDays[0]);
    const lastDay = new Date(observedDays[observedDays.length - 1]);

    // Generate all days in the range
    const allDays = [];
    const currentDay = new Date(firstDay);
    while (currentDay <= lastDay) {
        allDays.push(fmtDate(currentDay));
        currentDay.setDate(currentDay.getDate() + 1);
    }

    const days = allDays;
    const programs = Array.from(new Set(data.map(d => getBaseBlockName(d.program))));
    const color = d3.scaleOrdinal().domain(programs).range(d3.schemeTableau10);

    // Layout - adjusted for horizontal timeline with days on y-axis
    const margin = { top: 20, right: 20, bottom: 140, left: 80 }, // Increased bottom margin for multiple x-axes with proper spacing
          width = 1200,
          rowHeight = 20,
          innerWidth = width - margin.left - margin.right,
          innerHeight = days.length * rowHeight,
          height = innerHeight + margin.top + margin.bottom;

    const svg = d3.select("#chart")
                  .append("svg")
                  .attr("width", width)
                  .attr("height", height);

    const g = svg.append("g")
                 .attr("transform", `translate(${margin.left},${margin.top})`);

    // Scales - x is now time (hours since UTC-3 noon), y is now days
    const xminHour = 0, xmaxHour = 24; // 24-hour period starting from UTC-3 noon
    const x = d3.scaleLinear()
                .domain([xminHour, xmaxHour])
                .range([0, innerWidth]);

    const y = d3.scaleBand()
                .domain(days)
                .range([0, innerHeight])
                .padding(0.1);

    // Cerro Pachón coordinates (Rubin Observatory)
    const CERRO_PACHON_LAT = -30.2408;
    const CERRO_PACHON_LON = -70.7364;
    const CERRO_PACHON_ELEVATION = 2715; // meters

    // Function to calculate twilight times for a given astronomical day
    function calculateTwilightTimes(astronomicalDayStr) {
        try {
            // Parse the astronomical day string (YYYY-MM-DD format)
            const [year, month, day] = astronomicalDayStr.split('-').map(Number);

            // Check if Astronomy Engine is available
            if (typeof Astronomy === 'undefined') {
                console.warn('Astronomy Engine not loaded, using fallback');
                return [];
            }            // Create observer object for Cerro Pachón
            const observer = new Astronomy.Observer(CERRO_PACHON_LAT, CERRO_PACHON_LON, CERRO_PACHON_ELEVATION);

            // The astronomical day starts at 15:00 UTC (noon UTC-3)
            const dayStart = new Date(Date.UTC(year, month - 1, day, 15, 0, 0));
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

            const events = [];

            // Define twilight elevation angles (standard astronomical definitions)
            const twilightEvents = [
                { name: 'sunset', angle: -0.8333, direction: -1 },
                { name: 'civil_dusk', angle: -6, direction: -1 },
                { name: 'nautical_dusk', angle: -12, direction: -1 },
                { name: 'astronomical_dusk', angle: -18, direction: -1 },
                { name: 'astronomical_dawn', angle: -18, direction: +1 },
                { name: 'nautical_dawn', angle: -12, direction: +1 },
                { name: 'civil_dawn', angle: -6, direction: +1 },
                { name: 'sunrise', angle: -0.8333, direction: +1 }
            ];

            // Search for each twilight event
            for (let twilight of twilightEvents) {
                try {
                    // Start search from beginning of astronomical day
                    let searchTime = Astronomy.MakeTime(dayStart);

                    // Search for altitude crossing within the 24-hour period
                    const result = Astronomy.SearchAltitude(
                        Astronomy.Body.Sun,
                        observer,
                        twilight.direction,
                        searchTime,
                        1.0, // search 1 day
                        twilight.angle
                    );

                    if (result) {
                        // Get the Date object from the AstroTime result
                        const eventDate = result.date;

                        // Check if event falls within our astronomical day
                        if (eventDate >= dayStart && eventDate < dayEnd) {
                            const minutesSinceNoon = (eventDate.getTime() - dayStart.getTime()) / (1000 * 60);
                            const hoursSinceNoon = minutesSinceNoon / 60;

                            events.push({
                                type: twilight.name,
                                time: eventDate,
                                hours: hoursSinceNoon,
                                minutes: minutesSinceNoon
                            });
                        }
                    }
                } catch (e) {
                    console.warn(`Could not find ${twilight.name} for ${astronomicalDayStr}:`, e.message);
                }
            }

            // Sort events by time
            events.sort((a, b) => a.minutes - b.minutes);

            return events;

        } catch (error) {
            console.error(`Error calculating twilight for ${astronomicalDayStr}:`, error);
            return [];
        }
    }

    // Function to create twilight background for a single day
    function createTwilightBackground(astronomicalDayStr) {
        const events = calculateTwilightTimes(astronomicalDayStr);
        const backgrounds = [];

        // Define background colors for different periods
        const colors = {
            day: { color: '#87ceeb', opacity: 0.1 },           // Sky blue, very light
            civil: { color: '#ffa500', opacity: 0.15 },        // Orange
            nautical: { color: '#4169e1', opacity: 0.2 },      // Royal blue
            astronomical: { color: '#191970', opacity: 0.25 }, // Midnight blue
            night: { color: '#1a1a2e', opacity: 0.3 }          // Very dark blue
        };

        // Start with day since astronomical day begins at noon local (15:00 UTC)
        let currentMinutes = 0;
        let currentState = 'day';

        // If no events found, default to day for the entire period
        if (events.length === 0) {
            backgrounds.push({
                start: 0,
                end: 24,
                type: 'day',
                ...colors.day
            });
            return backgrounds;
        }

        // Process each twilight event
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            const eventHours = event.minutes / 60; // Convert minutes to hours for display

            // Add background for current state up to this event
            if (eventHours > currentMinutes / 60) {
                backgrounds.push({
                    start: currentMinutes / 60,
                    end: eventHours,
                    type: currentState,
                    ...colors[currentState]
                });
            }

            // Update state based on event type
            switch (event.type) {
                case 'sunset':
                    currentState = 'civil';
                    break;
                case 'civil_dusk':
                    currentState = 'nautical';
                    break;
                case 'nautical_dusk':
                    currentState = 'astronomical';
                    break;
                case 'astronomical_dusk':
                    currentState = 'night';
                    break;
                case 'astronomical_dawn':
                    currentState = 'astronomical';
                    break;
                case 'nautical_dawn':
                    currentState = 'nautical';
                    break;
                case 'civil_dawn':
                    currentState = 'civil';
                    break;
                case 'sunrise':
                    currentState = 'day';
                    break;
            }

            currentMinutes = event.minutes;
        }

        // Add final background from last event to end of day
        const finalHours = currentMinutes / 60;
        if (finalHours < 24) {
            backgrounds.push({
                start: finalHours,
                end: 24,
                type: currentState,
                ...colors[currentState]
            });
        }

        return backgrounds;
    }

    // Function to calculate moon rise and set times for a given astronomical day
    function calculateMoonTimes(astronomicalDayStr) {
        try {
            // Parse the astronomical day string (YYYY-MM-DD format)
            const [year, month, day] = astronomicalDayStr.split('-').map(Number);

            // Check if Astronomy Engine is available
            if (typeof Astronomy === 'undefined') {
                console.warn('Astronomy Engine not loaded, cannot calculate moon times');
                return null;
            }

            // Create observer object for Cerro Pachón
            const observer = new Astronomy.Observer(CERRO_PACHON_LAT, CERRO_PACHON_LON, CERRO_PACHON_ELEVATION);

            // The astronomical day starts at 15:00 UTC (noon UTC-3)
            const dayStart = new Date(Date.UTC(year, month - 1, day, 15, 0, 0));
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

            let moonrise = null;
            let moonset = null;

            try {
                // Search for moonrise within this astronomical day
                const searchStart = Astronomy.MakeTime(dayStart);

                // Use SearchRiseSet to find moonrise and moonset
                const riseSetResult = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, +1, searchStart, 1.0);

                if (riseSetResult && riseSetResult.date >= dayStart && riseSetResult.date < dayEnd) {
                    const minutesSinceNoon = (riseSetResult.date.getTime() - dayStart.getTime()) / (1000 * 60);
                    moonrise = {
                        time: riseSetResult.date,
                        hours: minutesSinceNoon / 60,
                        minutes: minutesSinceNoon
                    };
                }

                // Search for moonset within this astronomical day
                const setResult = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, -1, searchStart, 1.0);

                if (setResult && setResult.date >= dayStart && setResult.date < dayEnd) {
                    const minutesSinceNoon = (setResult.date.getTime() - dayStart.getTime()) / (1000 * 60);
                    moonset = {
                        time: setResult.date,
                        hours: minutesSinceNoon / 60,
                        minutes: minutesSinceNoon
                    };
                }

            } catch (e) {
                console.warn(`Could not find moon rise/set for ${astronomicalDayStr}:`, e.message);
            }

            return { moonrise, moonset };

        } catch (error) {
            console.error(`Error calculating moon times for ${astronomicalDayStr}:`, error);
            return null;
        }
    }

    // Tooltip
    const tooltip = d3.select("body")
                      .append("div")
                      .attr("class", "tooltip");

    // Selection state
    let selectedBlock = null;
    let highlightedProgram = null;

    // Info panel elements
    const infoPanel = d3.select("#info-panel");
    const panelTitle = d3.select("#panel-title");
    const panelContent = d3.select("#panel-content");

    // Function to position info panel next to the chart
    function showInfoPanel() {
        const chartElement = d3.select("#chart").node();
        const chartRect = chartElement.getBoundingClientRect();

        // Position based on the chart div's left edge plus the SVG width and padding
        const chartLeft = chartRect.left;
        const panelLeft = chartLeft + width + 16; // width + padding

        infoPanel
            .style("display", "block")
            .style("left", panelLeft + "px");
    }

    function hideInfoPanel() {
        infoPanel.style("display", "none");
    }

    // Functions for info panels
    function showSingleBlockInfo(d) {
        // For spanning blocks, use original block's times; otherwise use the data object's times
        const originalBlock = d.originalBlock || d;
        const durationH = originalBlock.durationH || (originalBlock.end - originalBlock.begin) / 3600000;

        // Generate the visit URL using day_obs and seq_num_0
        const dayObs = d.day.replace(/-/g, ''); // Convert YYYY-MM-DD to YYYYMMDD
        const seqPadded = d.seq_num_0.toString().padStart(5, '0'); // Pad seq_num_0 to 5 digits
        const visitUrl = `https://usdf-rsp-dev.slac.stanford.edu/fov-quicklook/visits/raw:${dayObs}${seqPadded}`;

        // Generate the FITS viewer URL
        const seqPaddedFits = d.seq_num_0.toString().padStart(6, '0'); // Pad seq_num_0 to 6 digits for FITS
        const fitsUrl = `http://lsstcam-mcm.cp.lsst.org/FITSInfo/view.html?image=MC_O_${dayObs}_${seqPaddedFits}&raft=all&color=grey&bias=Simple+Overscan+Correction&scale=Per-Segment&source=raw`;

        // Get description from translation table if available
        const description = getDescription(d.program);

        panelTitle.text("Block Information");
        panelContent.html(`
            <div class="info-item">
                <div class="info-label">Program:</div>
                <div>${d.program}</div>
            </div>
            ${description ? `
            <div class="info-item">
                <div class="info-label">Description:</div>
                <div style="font-style: italic; color: #666;">${description}</div>
            </div>
            ` : ''}
            <div class="info-item">
                <div class="info-label">Observation Day:</div>
                <div>${d.day}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Sequence Range:</div>
                <div>${d.seq_num_0} - ${d.seq_num_1}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Start Time:</div>
                <div>${fmtTime(originalBlock.begin)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">End Time:</div>
                <div>${fmtTime(originalBlock.end)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Duration:</div>
                <div>${durationH.toFixed(2)} hours</div>
            </div>
            <div class="info-item">
                <div class="info-label">UTC Start:</div>
                <div>${originalBlock.begin.toISOString()}</div>
            </div>
            <div class="info-item">
                <div class="info-label">UTC End:</div>
                <div>${originalBlock.end.toISOString()}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Visit Link:</div>
                <div><a href="${visitUrl}" target="_blank" rel="noopener noreferrer">Quick Look USDF</a></div>
            </div>
            <div class="info-item">
                <div class="info-label">FITS Viewer:</div>
                <div><a href="${fitsUrl}" target="_blank" rel="noopener noreferrer">CCS Viewer Summit</a></div>
            </div>
        `);
        showInfoPanel();
    }

    function showProgramInfo(program) {
        // Filter blocks by base program name to include all versions
        // Use original blocks to avoid counting spanning parts multiple times
        const programBlocks = data
            .filter(d => getBaseBlockName(d.program) === program)
            .map(d => d.originalBlock || d); // Get original block if this is a spanning part

        // Remove duplicates (since spanning blocks appear multiple times in data)
        const uniqueBlocks = Array.from(new Set(programBlocks));

        // Calculate total duration, handling cases where durationH might not be present
        const totalDuration = uniqueBlocks.reduce((sum, d) => {
            const duration = d.durationH || (d.end - d.begin) / 3600000;
            return sum + duration;
        }, 0);
        const blockCount = uniqueBlocks.length;

        // Get all unique versions for display
        const versions = Array.from(new Set(uniqueBlocks.map(d => d.program))).sort();

        // Get date range from data blocks (which have the day property), not original blocks
        const programDataBlocks = data
            .filter(d => getBaseBlockName(d.program) === program && !d.isSpanningPart) // Only non-spanning parts to avoid duplicates
            .sort((a, b) => a.day.localeCompare(b.day));

        // Get description for the program (with BLOCK-T mapping)
        const description = getDescription(program);

        panelTitle.text("Program Summary");
        panelContent.html(`
            <div class="info-item">
                <div class="info-label">Program:</div>
                <div>${program}${versions.length > 1 ? ` (${versions.length} versions)` : ''}</div>
            </div>
            ${versions.length > 1 ? `
            <div class="info-item">
                <div class="info-label">Versions:</div>
                <div style="font-size: 0.9em; color: #666;">${versions.join(', ')}</div>
            </div>
            ` : ''}
            ${description ? `
            <div class="info-item">
                <div class="info-label">Description:</div>
                <div style="font-style: italic; color: #666;">${description}</div>
            </div>
            ` : ''}
            <div class="info-item">
                <div class="info-label">Total Blocks:</div>
                <div>${blockCount}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Total Duration:</div>
                <div>${totalDuration.toFixed(2)} hours</div>
            </div>
            <div class="info-item">
                <div class="info-label">Average Duration:</div>
                <div>${(totalDuration / blockCount).toFixed(2)} hours</div>
            </div>
            <div class="info-item">
                <div class="info-label">Date Range:</div>
                <div>${programDataBlocks.length > 0 ? `${programDataBlocks[0].day} to ${programDataBlocks[programDataBlocks.length - 1].day}` : 'No data'}</div>
            </div>
        `);
        showInfoPanel();
    }

    function hideInfoPanel() {
        infoPanel.style("display", "none");
    }

    function clearSelection() {
        selectedBlock = null;
        highlightedProgram = null;
        g.selectAll(".block")
            .classed("selected", false)
            .classed("highlighted", false);
        hideInfoPanel();
    }

    // Search functionality
    const searchInput = d3.select("#search-input");
    const searchResults = d3.select("#search-results");
    let selectedSearchIndex = -1; // Track which search result is selected
    let currentSearchResults = []; // Store current search results for navigation

    // Simple fuzzy matching function
    function fuzzyMatch(pattern, text) {
        pattern = pattern.toLowerCase();
        text = text.toLowerCase();

        // Exact match gets highest score
        if (text.includes(pattern)) {
            return { score: 1000, matched: true };
        }

        // Character-by-character fuzzy matching
        let patternIndex = 0;
        let score = 0;

        for (let i = 0; i < text.length && patternIndex < pattern.length; i++) {
            if (text[i] === pattern[patternIndex]) {
                score += 1;
                patternIndex++;
            }
        }

        // Return match if we found all pattern characters
        const matched = patternIndex === pattern.length;
        return { score: matched ? score : 0, matched };
    }

    function performSearch(query) {
        if (query.length === 0) {
            searchResults.style("display", "none");
            return;
        }

        // Get unique programs and rank them by fuzzy match score
        const rankedPrograms = programs
            .map(program => {
                // Search against program name
                const programMatch = fuzzyMatch(query, program);

                // Also search against descriptive title if available (with BLOCK-T mapping)
                const description = getDescription(program) || "";
                const descriptionMatch = description ? fuzzyMatch(query, description) : { score: 0, matched: false };

                // Use the best match between program name and description
                const bestMatch = programMatch.score >= descriptionMatch.score ? programMatch : descriptionMatch;

                return {
                    program,
                    ...bestMatch,
                    description // Store description for display
                };
            })
            .filter(item => item.matched)
            .sort((a, b) => b.score - a.score); // No limit on results

        if (rankedPrograms.length === 0) {
            searchResults.style("display", "none");
            currentSearchResults = [];
            selectedSearchIndex = -1;
            return;
        }

        // Store results for keyboard navigation
        currentSearchResults = rankedPrograms;
        selectedSearchIndex = -1; // Reset selection

        // Display search results
        const items = searchResults
            .style("display", "block")
            .selectAll(".search-result-item")
            .data(rankedPrograms, d => d.program);

        items.enter()
            .append("div")
            .attr("class", "search-result-item")
            .merge(items)
            .html(d => {
                const description = d.description;
                if (description) {
                    return `<div style="font-weight: bold;">${d.program}</div><div style="font-size: 0.9em; color: #666; margin-top: 2px;">${description}</div>`;
                } else {
                    return d.program;
                }
            })
            .classed("search-highlighted", (d, i) => i === selectedSearchIndex)
            .on("click", function(event, d) {
                selectProgram(d.program);
                searchInput.node().value = "";
                searchResults.style("display", "none");
                currentSearchResults = [];
                selectedSearchIndex = -1;
            });

        items.exit().remove();
    }

    // Function to update search result highlighting
    function updateSearchHighlight() {
        searchResults.selectAll(".search-result-item")
            .classed("search-highlighted", (d, i) => i === selectedSearchIndex);

        // Scroll the selected item into view
        if (selectedSearchIndex >= 0) {
            const selectedElement = searchResults.selectAll(".search-result-item").nodes()[selectedSearchIndex];
            if (selectedElement) {
                selectedElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                });
            }
        }
    }

    function selectProgram(program) {
        clearSelection();
        const baseProgram = getBaseBlockName(program);
        highlightedProgram = baseProgram;

        // Highlight all blocks with the same base program (including versions)
        const highlightedBlocks = g.selectAll(".block")
            .classed("highlighted", blockData => getBaseBlockName(blockData.program) === baseProgram);

        // Add flash animation to highlighted blocks
        highlightedBlocks
            .filter(blockData => getBaseBlockName(blockData.program) === baseProgram)
            .classed("flash", true)
            .on("animationend.flash", function() {
                d3.select(this).classed("flash", false).on("animationend.flash", null);
            });

        showProgramInfo(baseProgram);

        // Scroll to the first block of this program
        const firstBlock = data.find(d => getBaseBlockName(d.program) === baseProgram);
        if (firstBlock) {
            const blockElement = g.selectAll(".block")
                .filter(d => d === firstBlock)
                .node();

            if (blockElement) {
                // Get the position of the block relative to the page
                const rect = blockElement.getBoundingClientRect();
                const svgRect = svg.node().getBoundingClientRect();

                // Calculate the scroll position to center the block vertically
                const blockY = rect.top + window.pageYOffset;
                const viewportHeight = window.innerHeight;
                const scrollY = blockY - (viewportHeight / 2);

                // Smooth scroll to the block
                window.scrollTo({
                    top: Math.max(0, scrollY),
                    behavior: 'smooth'
                });
            }
        }
    }

    // Search input event listeners
    searchInput.on("input", function() {
        const query = this.value.trim();
        performSearch(query);
    });

    searchInput.on("keydown", function(event) {
        if (event.key === "Escape") {
            this.value = "";
            searchResults.style("display", "none");
            currentSearchResults = [];
            selectedSearchIndex = -1;
            this.blur();
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            if (currentSearchResults.length > 0) {
                selectedSearchIndex = Math.min(selectedSearchIndex + 1, currentSearchResults.length - 1);
                updateSearchHighlight();
            }
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (currentSearchResults.length > 0) {
                selectedSearchIndex = Math.max(selectedSearchIndex - 1, -1);
                updateSearchHighlight();
            }
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (selectedSearchIndex >= 0 && selectedSearchIndex < currentSearchResults.length) {
                const selectedResult = currentSearchResults[selectedSearchIndex];
                selectProgram(selectedResult.program);
                this.value = "";
                searchResults.style("display", "none");
                currentSearchResults = [];
                selectedSearchIndex = -1;
            }
        }
    });

    // Hide search results when clicking outside
    d3.select("body").on("click", function(event) {
        if (!event.target.closest("#search-container")) {
            searchResults.style("display", "none");
        }
    });

    // Add axes
    // X-axis (time of day) - astronomical time starting from UTC-3 noon (15:00 UTC)
    const xAxis = d3.axisBottom(x)
                    .tickFormat(d => {
                        // Convert hours since UTC-3 noon to UTC time
                        // d=0 corresponds to 15:00 UTC, d=9 corresponds to 00:00 UTC (next day)
                        let utcHour = (d + 15) % 24;
                        return utcHour.toString().padStart(2, '0') + ":00";
                    })
                    .ticks(12);

    g.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(xAxis);

    // X-axis for Chile Standard Time (CLT, UTC-3)
    const xAxisCLT = d3.axisBottom(x)
                       .tickFormat(d => {
                           // Convert hours since UTC-3 noon to CLT (UTC-3)
                           let cltHour = (d + 15 - 3) % 24;
                           return cltHour.toString().padStart(2, '0') + ":00";
                       })
                       .ticks(12);

    g.append("g")
        .attr("class", "x-axis x-axis-clt")
        .attr("transform", `translate(0,${innerHeight + 40})`)
        .call(xAxisCLT);

    // X-axis for Chile Daylight Time (CLDT, UTC-4)
    const xAxisCLDT = d3.axisBottom(x)
                        .tickFormat(d => {
                            // Convert hours since UTC-3 noon to CLDT (UTC-4)
                            let cldtHour = (d + 15 - 4) % 24;
                            return cldtHour.toString().padStart(2, '0') + ":00";
                        })
                        .ticks(12);

    g.append("g")
        .attr("class", "x-axis x-axis-cldt")
        .attr("transform", `translate(0,${innerHeight + 80})`)
        .call(xAxisCLDT);

    // Y-axis (observation days)
    const yAxis = d3.axisLeft(y);

    g.append("g")
        .attr("class", "y-axis")
        .call(yAxis);

    // Axis labels
    g.append("text")
        .attr("class", "axis-label")
        .attr("x", -10)
        .attr("y", innerHeight + 5)
        .style("text-anchor", "end")
        .style("font-size", "10px")
        .text("UTC");

    g.append("text")
        .attr("class", "axis-label")
        .attr("x", -10)
        .attr("y", innerHeight + 45)
        .style("text-anchor", "end")
        .style("font-size", "10px")
        .text("CLT (UTC-3)");

    g.append("text")
        .attr("class", "axis-label")
        .attr("x", -10)
        .attr("y", innerHeight + 85)
        .style("text-anchor", "end")
        .style("font-size", "10px")
        .text("CLDT (UTC-4)");

    // Draw twilight backgrounds
    days.forEach(day => {
        const backgrounds = createTwilightBackground(day);

        backgrounds.forEach(bg => {
            g.append("rect")
                .attr("class", "twilight-background")
                .attr("x", x(bg.start))
                .attr("y", y(day))
                .attr("width", x(bg.end) - x(bg.start))
                .attr("height", y.bandwidth())
                .attr("fill", bg.color)
                .attr("opacity", bg.opacity)
                .style("pointer-events", "none"); // Don't interfere with block interactions
        });
    });

    // Draw moon overlays
    days.forEach(day => {
        const moonTimes = calculateMoonTimes(day);

        if (moonTimes && (moonTimes.moonrise || moonTimes.moonset)) {
            // Determine the period when the moon is visible (above horizon)
            let moonVisibleStart = null;
            let moonVisibleEnd = null;

            if (moonTimes.moonrise && moonTimes.moonset) {
                // Both rise and set within the day
                if (moonTimes.moonrise.hours < moonTimes.moonset.hours) {
                    // Normal case: rise then set
                    moonVisibleStart = moonTimes.moonrise.hours;
                    moonVisibleEnd = moonTimes.moonset.hours;
                } else {
                    // Moon sets before it rises (was already up at start of day)
                    // Create two segments: start to set, and rise to end
                    g.append("rect")
                        .attr("class", "moon-overlay")
                        .attr("x", x(0))
                        .attr("y", y(day))
                        .attr("width", x(moonTimes.moonset.hours) - x(0))
                        .attr("height", y.bandwidth())
                        .attr("fill", "#b3d9ff")
                        .attr("opacity", 0.4)
                        .style("pointer-events", "none");

                    moonVisibleStart = moonTimes.moonrise.hours;
                    moonVisibleEnd = 24;
                }
            } else if (moonTimes.moonrise) {
                // Only moonrise within the day
                moonVisibleStart = moonTimes.moonrise.hours;
                moonVisibleEnd = 24;
            } else if (moonTimes.moonset) {
                // Only moonset within the day (moon was up at start)
                moonVisibleStart = 0;
                moonVisibleEnd = moonTimes.moonset.hours;
            }

            // Draw the main moon visibility period
            if (moonVisibleStart !== null && moonVisibleEnd !== null) {
                g.append("rect")
                    .attr("class", "moon-overlay")
                    .attr("x", x(moonVisibleStart))
                    .attr("y", y(day))
                    .attr("width", x(moonVisibleEnd) - x(moonVisibleStart))
                    .attr("height", y.bandwidth())
                    .attr("fill", "#b3d9ff")  // More saturated blue
                    .attr("opacity", 0.4)     // Nice balance of visibility
                    .style("pointer-events", "none"); // Don't interfere with block interactions
            }
        }
    });

    // Draw Blocks
    const blockElements = g.selectAll("rect.block")
        .data(data)
        .join("rect")
            .attr("class", "block")
            .attr("x", d => x(d.x0))
            .attr("y", d => y(d.day))
            .attr("width", d => x(d.x1) - x(d.x0))
            .attr("height", y.bandwidth())
            .attr("fill", d => color(getBaseBlockName(d.program)))
            .on("click", function(event, d) {
                event.stopPropagation();
                clearSelection();
                selectedBlock = d.originalBlock || d; // Use original block for spanning parts

                // Highlight all parts of this block (for spanning blocks)
                const selectedBlocks = g.selectAll(".block")
                    .classed("selected", blockData => blockData.blockId === d.blockId);

                // Add flash animation to selected blocks
                selectedBlocks
                    .filter(blockData => blockData.blockId === d.blockId)
                    .classed("flash", true)
                    .on("animationend.flash", function() {
                        d3.select(this).classed("flash", false).on("animationend.flash", null);
                    });

                showSingleBlockInfo(d); // Always pass the clicked data object, not original
            })
            .on("dblclick", function(event, d) {
                event.stopPropagation();
                clearSelection();

                // Get the base block name to select all versions
                const baseBlockName = getBaseBlockName(d.program);
                highlightedProgram = baseBlockName;

                // Highlight all blocks with the same base program (all versions)
                const highlightedBlocks = g.selectAll(".block")
                    .classed("highlighted", blockData => getBaseBlockName(blockData.program) === baseBlockName);

                // Add flash animation to highlighted blocks
                highlightedBlocks
                    .filter(blockData => getBaseBlockName(blockData.program) === baseBlockName)
                    .classed("flash", true)
                    .on("animationend.flash", function() {
                        d3.select(this).classed("flash", false).on("animationend.flash", null);
                    });

                showProgramInfo(baseBlockName);
            })
            .on("mouseenter", function(event, d) {
                const originalBlock = d.originalBlock || d;
                const durationH = originalBlock.durationH || (originalBlock.end - originalBlock.begin) / 3600000;
                tooltip
                    .style("opacity", 1)
                    .html(
                        `Program: ${d.program}<br>` +
                        `Day: ${d.day}<br>` +
                        `Begin: ${fmtTime(originalBlock.begin)}<br>` +
                        `End: ${fmtTime(originalBlock.end)}<br>` +
                        `Duration: ${durationH.toFixed(2)} h${d.isSpanningPart ? ' (spans days)' : ''}`
                    );
            })
            .on("mousemove", (event) => {
                tooltip
                    .style("left", (event.pageX + 10) + "px")
                    .style("top", (event.pageY + 10) + "px");
            })
            .on("mouseleave", () => {
                tooltip.style("opacity", 0);
            });

    // Click away to deselect
    svg.on("click", function(event) {
        clearSelection();
    });

    // Global keyboard shortcuts
    d3.select("body").on("keydown", function(event) {
        // Don't trigger if user is already typing in the search box or other input
        if (event.target.tagName === 'INPUT') {
            return;
        }

        if (event.key === "/" || (event.ctrlKey && event.key === "f")) {
            event.preventDefault();
            searchInput.node().focus();
        }
    });
});