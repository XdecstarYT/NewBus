/** The whole API as one function: Request in, Response out. */
import './routes/auth';
import './routes/game';
import './routes/politics';
import './routes/owner';
import './routes/work';
import './routes/town';
import './routes/estate';
import './routes/government';
export { handle } from './http/router';
