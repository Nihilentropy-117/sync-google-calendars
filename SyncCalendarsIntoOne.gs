// ----------------------------------------------------------------------------
// CONFIGURATION - EDIT THESE VALUES
// ----------------------------------------------------------------------------

// Calendars to merge from.
// The key is the nickname that will appear in the shared calendar as "Nickname Busy".
// You can specify a single calendar ID as a string, or multiple calendar IDs as an array.
// Examples:
//   "[Alice]": "alice@gmail.com" → creates events titled "[Alice] Busy"
//   "[Bob]": ["bob-personal@gmail.com", "bob-work@gmail.com"] → merges both calendars as "[Bob] Busy"
const CALENDARS_TO_MERGE = {
  "[Gray]": ["graylott@gmail.com", "915c93022746806c7f5962f599a8715d97791befc28ea4ac82cb71500e92c148@group.calendar.google.com"],
  "[Jared]": "jaredscomputer@gmail.com",
  "[Kas]": "kasjohnson1999@gmail.com"
}

// The ID of the shared calendar
const CALENDAR_TO_MERGE_INTO = "8800a10c257c428f0ca1f13de599cd919e454124b7f4b3bdcb93a7b9c452a933@group.calendar.google.com"

// Number of days in the past and future to sync.
const SYNC_DAYS_IN_PAST = 7
const SYNC_DAYS_IN_FUTURE = 30

// Default title for events that don't have a title.
const DEFAULT_EVENT_TITLE = "Busy"

// Unique character to use in the title of the event to identify it as a clone.
// This is used to delete the old events.
// https://unicode-table.com/en/200B/
const SEARCH_CHARACTER = "\u200B"

// ----------------------------------------------------------------------------
// DO NOT TOUCH FROM HERE ON
// ----------------------------------------------------------------------------

// Base endpoint for the calendar API
const ENDPOINT_BASE = "https://www.googleapis.com/calendar/v3/calendars"

// ----------------------------------------------------------------------------
// BATCH REQUEST CLASS (Based on https://github.com/tanaikech/BatchRequest)
// ----------------------------------------------------------------------------

class BatchRequest {
  constructor(obj) {
    if (!obj.hasOwnProperty('requests')) {
      throw new Error("'requests' property was not found in object.");
    }

    this.reqs = obj.requests.slice();
    this.url = 'https://www.googleapis.com/batch';

    if (obj.batchPath) {
      const batchPath = obj.batchPath.trim();

      if (~batchPath.indexOf('batch/')) {
        this.url += batchPath.replace('batch', '');
      } else {
        this.url += batchPath.slice(0, 1) === '/' ? batchPath : `/${batchPath}`;
      }
    }

    this.accessToken = obj.accessToken || ScriptApp.getOAuthToken();

    if (obj.useFetchAll === true || this.reqs.length > 1) {
      return this.enhancedDo();
    } else {
      let res = UrlFetchApp.fetch(this.url, this.createRequest(this.reqs));

      res = this.parser(res.getContentText());
      return res;
    }
  }

  enhancedDo() {
    const limit = 100;
    const split = Math.ceil(this.reqs.length / limit);

    if (typeof UrlFetchApp.fetchAll === 'function') {
      const reqs = [];
      var i = 0;
      var j = 0;

      for (; 0 <= split ? j < split : j > split; i = 0 <= split ? ++j : --j) {
        const params = this.createRequest(this.reqs.splice(0, limit));
        params.url = this.url;
        reqs.push(params);
      }

      const res = UrlFetchApp.fetchAll(reqs).reduce((array, item) => {
        if (item.getResponseCode() !== 200) {
          array.push(item.getContentText());
        } else {
          array = array.concat(this.parser(item.getContentText()));
        }
        return array;
      }, []);

      return res;
    }

    var allResponses = [];
    var i = 0;
    var k = 0;
    for (; 0 <= split ? k < split : k > split; i = 0 <= split ? ++k : --k) {
      const params = this.createRequest(this.reqs.splice(0, limit));

      const response = UrlFetchApp.fetch(this.url, params);

      if (response.getResponseCode() !== 200) {
        allResponses.push(response.getContentText());
      } else {
        allResponses = allResponses.concat(
          this.parser(response.getContentText())
        );
      }
    }

    return allResponses;
  }

  parser(contentText) {
    const regex = /{[\S\s]+}/g;
    var temp = contentText.split('--batch');

    return temp.slice(1, temp.length - 1).map((e) => {
      if (regex.test(e)) {
        return JSON.parse(e.match(regex)[0]);
      }
      return e;
    });
  }

  createRequest(requests) {
    const boundary = 'xxxxxxxxxx';

    var contentId = 0;
    var data = `--${boundary}\r\n`;
    requests.forEach((req) => {
      data +=
        `Content-Type: application/http\r\n` +
        `Content-ID: ${++contentId}\r\n\r\n` +
        `${req.method} ${req.endpoint}\r\n`;

      if (req.accessToken) {
        data += `Authorization: Bearer ${req.accessToken}\r\n`;
      }

      if (req.requestBody) {
        data +=
          `Content-Type: application/json; charset=utf-8\r\n\r\n` +
          `${JSON.stringify(req.requestBody)}\r\n`;
      } else {
        data += '\r\n';
      }

      data += `--${boundary}\r\n`;

      return data;
    });

    return {
      muteHttpExceptions: true,
      method: 'post',
      contentType: `multipart/mixed; boundary=${boundary}`,
      payload: Utilities.newBlob(data).getBytes(),
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    };
  }
}

// ----------------------------------------------------------------------------
// MAIN FUNCTIONS
// ----------------------------------------------------------------------------

function SyncCalendarsIntoOne() {
  console.log("=== Starting SyncCalendarsIntoOne ===")

  // Start time is today at midnight - SYNC_DAYS_IN_PAST
  const startTime = new Date()
  startTime.setHours(0, 0, 0, 0)
  startTime.setDate(startTime.getDate() - SYNC_DAYS_IN_PAST)

  // End time is today at midnight + SYNC_DAYS_IN_FUTURE
  const endTime = new Date()
  endTime.setHours(0, 0, 0, 0)
  endTime.setDate(endTime.getDate() + SYNC_DAYS_IN_FUTURE + 1)

  console.log(`Syncing events from ${startTime.toISOString()} to ${endTime.toISOString()}`)

  // Delete any old events that have been already cloned over.
  const deleteStartTime = new Date()
  deleteStartTime.setFullYear(2000, 01, 01)
  deleteStartTime.setHours(0, 0, 0, 0)

  deleteEvents(deleteStartTime, endTime)
  createEvents(startTime, endTime)

  console.log("=== Finished SyncCalendarsIntoOne ===")
}

// Delete any old events that have been already cloned over.
// This is basically a sync w/o finding and updating. Just deleted and recreate.
function deleteEvents(startTime, endTime) {
  const sharedCalendar = CalendarApp.getCalendarById(CALENDAR_TO_MERGE_INTO)

  // Find events with the search character in the title.
  // The `.filter` method is used since the getEvents method seems to return all events at the moment. It's a safety check.
  const events = sharedCalendar
    .getEvents(startTime, endTime, { search: SEARCH_CHARACTER })
    .filter((event) => event.getTitle().includes(SEARCH_CHARACTER))

  const requestBody = events.map((e, i) => ({
    method: "DELETE",
    endpoint: `${ENDPOINT_BASE}/${CALENDAR_TO_MERGE_INTO}/events/${e.getId().replace("@google.com", "")}`,
  }))

  if (requestBody && requestBody.length) {
    const result = new BatchRequest({
      useFetchAll: true,
      batchPath: "batch/calendar/v3",
      requests: requestBody,
    })

    if (result.length !== requestBody.length) {
      console.log(result)
    }

    console.log(`${result.length} deleted events between ${startTime} and ${endTime}.`)
  } else {
    console.log("No events to delete.")
  }
}

function createEvents(startTime, endTime) {
  let requestBody = []

  console.log(`Processing ${Object.keys(CALENDARS_TO_MERGE).length} nickname(s)...`)

  for (let calendarName in CALENDARS_TO_MERGE) {
    // Support both single calendar ID (string) or multiple calendar IDs (array)
    const calendarIds = Array.isArray(CALENDARS_TO_MERGE[calendarName])
      ? CALENDARS_TO_MERGE[calendarName]
      : [CALENDARS_TO_MERGE[calendarName]]

    console.log(`\nProcessing nickname: "${calendarName}" with ${calendarIds.length} calendar(s)`)

    let totalAddedForNickname = 0
    let totalSkippedForNickname = 0

    // Process each calendar ID for this nickname
    for (let calendarId of calendarIds) {
      console.log(`  📅 Calendar: ${calendarId}`)

      const calendarToCopy = CalendarApp.getCalendarById(calendarId)

      if (!calendarToCopy) {
        console.log("    ❌ Calendar not found")
        continue
      }

      // Find events
      const events = Calendar.Events.list(calendarId, {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      })

      // If nothing find, move to next calendar
      if (!(events.items && events.items.length > 0)) {
        console.log(`    ℹ️  No events found in date range`)
        continue
      }

      console.log(`    ✓ Found ${events.items.length} events`)

      let skippedFree = 0
      let addedEvents = 0

      events.items.forEach((event) => {
        // Don't copy "free" events.
        if (event.transparency && event.transparency === "transparent") {
          skippedFree++
          return
        }

        // Store original event title for description
        const originalTitle = event.summary || DEFAULT_EVENT_TITLE

        // Create description with original event title
        const descriptionParts = [`Original event: ${originalTitle}`]
        if (event.description) {
          descriptionParts.push(event.description)
        }
        const newDescription = descriptionParts.join("\n\n")

        requestBody.push({
          method: "POST",
          endpoint: `${ENDPOINT_BASE}/${CALENDAR_TO_MERGE_INTO}/events?conferenceDataVersion=1`,
          requestBody: {
            summary: `${SEARCH_CHARACTER}${calendarName} Busy`,
            location: event.location,
            description: newDescription,
            start: event.start,
            end: event.end,
            conferenceData: event.conferenceData,
          },
        })
        addedEvents++
      })

      console.log(`    ✓ Added ${addedEvents} events`)
      if (skippedFree > 0) {
        console.log(`    ℹ️  Skipped ${skippedFree} "free" events`)
      }

      totalAddedForNickname += addedEvents
      totalSkippedForNickname += skippedFree
    }

    console.log(`  ✅ Total for "${calendarName}": ${totalAddedForNickname} events added`)
  }

  if (requestBody && requestBody.length) {
    const result = new BatchRequest({
      batchPath: "batch/calendar/v3",
      requests: requestBody,
    })

    if (result.length !== requestBody.length) {
      console.log(result)
    }

    console.log(`${result.length} events created between ${startTime} and ${endTime}.`)
  } else {
    console.log("No events to create.")
  }
}
