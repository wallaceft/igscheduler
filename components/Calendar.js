import React, { useEffect, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

export default function SchedulerCalendar({ onEventClick }) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    fetch('/api/scheduled')
      .then(res => res.json())
      .then(data => {
        setEvents(data.scheduled.map(job => ({
          id: job.id,
          title: `@${job.username}`,
          start: job.datetime,
          color: job.status === 'pending' ? '#FFC107'
                 : job.status === 'completed' ? '#28A745'
                 : '#DC3545'
        })));
      });
  }, []);

  return (
    <FullCalendar
      plugins={[ dayGridPlugin, timeGridPlugin, interactionPlugin ]}
      initialView="timeGridWeek"
      headerToolbar={{
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      }}
      events={events}
      eventClick={info => onEventClick(info.event)}
      height="auto"
    />
  );
}
