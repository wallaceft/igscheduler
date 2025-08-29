import React from 'react';
import BulkForm from './components/BulkForm';
import SchedulerCalendar from './components/SchedulerCalendar';

export default function App() {
  const handleEventClick = event => {
    alert(`Agendamento: ${event.title}\nEm: ${event.start.toLocaleString()}`);
  };

  return (
    <div className="App">
      <header>IG Scheduler</header>
      <div className="main">
        <BulkForm />
        <div className="calendar-container">
          <SchedulerCalendar onEventClick={handleEventClick} />
        </div>
      </div>
    </div>
  );
}
